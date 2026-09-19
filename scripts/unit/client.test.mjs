import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, createLatestRequest, createMutationClient, getJson } from "../../src/lib/runtime/client.mjs";
function storage() {
  const values = new Map();
  return { get length() { return values.size; }, key: (n) => [...values.keys()][n] ?? null, getItem: (k) => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: (k) => values.delete(k), clear: () => values.clear(), values };
}
const ok = () => Response.json({ id: "33333333-3333-4333-8333-333333333333" });
const args = ["student-1", "/api/lab", "submit", { item: "D01", reason: "학생의 비공개 이유" }];
test("canonicalization sorts object keys, not array elements", () => {
  assert.equal(canonicalJson({ b: 2, a: [1, 3] }), canonicalJson({ a: [1, 3], b: 2 }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});
for (const value of [undefined, NaN, Infinity, new Date()]) test(`rejects non-JSON fingerprint input ${String(value)}`, () => assert.throws(() => canonicalJson(value)));
test("manual retry after network loss keeps the same request UUID", async () => {
  const calls = []; const client = createMutationClient({ fetchFn: async (_, init) => { calls.push(JSON.parse(init.body)); if (calls.length === 1) throw new Error("offline"); return ok(); } });
  await assert.rejects(client.send(...args)); await client.send(...args);
  assert.equal(calls[0].request, calls[1].request);
});
test("opaque pending journal survives page/client recreation", async () => {
  const store = storage(), calls = [];
  const a = createMutationClient({ storage: () => store, fetchFn: async (_, init) => { calls.push(JSON.parse(init.body)); throw new Error("lost"); } });
  await assert.rejects(a.send(...args));
  assert.ok(!JSON.stringify([...store.values]).includes("비공개"));
  const b = createMutationClient({ storage: () => store, fetchFn: async (_, init) => { calls.push(JSON.parse(init.body)); return ok(); } });
  await b.send(...args); assert.equal(calls[0].request, calls[1].request); assert.equal(store.length, 0);
});
test("simultaneous identical sends share one network call", async () => {
  let calls = 0;
  const client = createMutationClient({ fetchFn: async () => { calls++; await new Promise((r) => setTimeout(r, 15)); return ok(); } });
  await Promise.all([client.send(...args), client.send(...args)]); assert.equal(calls, 1);
});
test("acknowledged repeated new operation receives a new UUID", async () => {
  const ids = []; const client = createMutationClient({ fetchFn: async (_, init) => { ids.push(JSON.parse(init.body).request); return ok(); } });
  await client.send(...args); await client.send(...args); assert.notEqual(ids[0], ids[1]);
});
for (const response of [() => Response.json({ error: "unavailable" }, { status: 503 }), () => new Response("bad gateway", { status: 502 }), () => Response.json({ error: "timeout" }, { status: 408 }), () => Response.json({ unexpected: true })]) {
  test("ambiguous response preserves identity for retry", async () => {
    const ids = []; const client = createMutationClient({ fetchFn: async (_, init) => { ids.push(JSON.parse(init.body).request); return ids.length === 1 ? response() : ok(); } });
    await assert.rejects(client.send(...args)); await client.send(...args); assert.equal(ids[0], ids[1]);
  });
}
test("definitive rejection retires the pending request", async () => {
  const ids = []; const client = createMutationClient({ fetchFn: async (_, init) => { ids.push(JSON.parse(init.body).request); return ids.length === 1 ? Response.json({ error: "invalid" }, { status: 422 }) : ok(); } });
  await assert.rejects(client.send(...args)); await client.send(...args); assert.notEqual(ids[0], ids[1]);
});
test("pending identifiers never cross users", async () => {
  const store = storage(), ids = []; const client = createMutationClient({ storage: () => store, fetchFn: async (_, init) => { ids.push(JSON.parse(init.body).request); throw Error("offline"); } });
  await assert.rejects(client.send(...args)); await assert.rejects(client.send("student-2", ...args.slice(1))); assert.notEqual(ids[0], ids[1]);
});
test("passwords are not journaled, auth requests not auto-retried", async () => {
  const store = storage(); let calls = 0;
  const client = createMutationClient({ storage: () => store, fetchFn: async () => { calls++; throw Error("offline"); } });
  await assert.rejects(client.send("guest", "/api/lab", "login", { email: "a@example.com", password: "private-password" }));
  assert.equal(store.length, 0); assert.equal(calls, 1);
});
test("unresolved writes are not silently evicted at the journal limit", async () => {
  let calls = 0; const client = createMutationClient({ maxPending: 1, fetchFn: async () => { calls++; throw Error("offline"); } });
  await assert.rejects(client.send(...args));
  await assert.rejects(client.send("student-1", "/api/lab", "submit", { reason: "different" }), /기존 요청/);
  assert.equal(calls, 1);
});
test("unavailable sessionStorage falls back to per-page deduplication", async () => {
  const ids = []; const client = createMutationClient({ storage: () => { throw Error("disabled"); }, fetchFn: async (_, init) => { ids.push(JSON.parse(init.body).request); if (ids.length === 1) throw Error("offline"); return ok(); } });
  await assert.rejects(client.send(...args)); await client.send(...args); assert.equal(ids[0], ids[1]);
});
test("latest request fences results even when transport ignores cancellation", () => {
  const gate = createLatestRequest(), a = gate.begin(), b = gate.begin();
  assert.equal(a.signal.aborted, true); assert.equal(a.isCurrent(), false); assert.equal(b.isCurrent(), true);
  gate.cancel(); assert.equal(b.isCurrent(), false);
});
test("GET timeout becomes a safe read error", async () => {
  const fetchFn = (_, { signal }) => new Promise((_, reject) => { signal.addEventListener("abort", () => reject(Error("aborted")), { once: true }); });
  await assert.rejects(getJson("/api/lab", new AbortController().signal, { fetchFn, timeoutMs: 10 }), /연결/);
});
test("write timeout preserves original UUID", async () => {
  const ids = [];
  const client = createMutationClient({ timeoutMs: 10, fetchFn: async (_, init) => { ids.push(JSON.parse(init.body).request); if (ids.length > 1) return ok(); return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Error("timeout")), { once: true })); } });
  await assert.rejects(client.send(...args)); await client.send(...args); assert.equal(ids[0], ids[1]);
});

test("a caller mutation during fingerprinting cannot alter the transmitted snapshot", async () => {
  let body;
  const client = createMutationClient({ fetchFn: async (_, init) => { body = JSON.parse(init.body); return ok(); } });
  const data = { reason: "original" };
  const sending = client.send("student", "/api/lab", "submit", data);
  data.reason = "mutated";
  await sending;
  assert.equal(body.data.reason, "original");
});
test("ok:true is not a write acknowledgement for record commands", async () => {
  const ids = [];
  const client = createMutationClient({ fetchFn: async (_, init) => { ids.push(JSON.parse(init.body).request); return ids.length === 1 ? Response.json({ ok: true }) : ok(); } });
  await assert.rejects(client.send(...args)); await client.send(...args); assert.equal(ids[0], ids[1]);
});
