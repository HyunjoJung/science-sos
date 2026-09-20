import test from "node:test";
import assert from "node:assert/strict";
import { readJson, requireOrigin, rpcError, publicFailure, AppError } from "../../src/lib/runtime/http.mjs";
const request = (body, headers = {}) => new Request("https://school.example/api/lab", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
const status = (n) => (error) => error instanceof AppError && error.status === n;
test("reads Korean JSON without losing Unicode", async () => assert.deepEqual(await readJson(request('{"reason":"밀도 😀"}')), { reason: "밀도 😀" }));
test("malformed JSON is 400, not a user rubric failure", async () => assert.rejects(readJson(request('{')), status(400)));
test("HTML/form body is not accepted as JSON", async () => assert.rejects(readJson(request("{}", { "Content-Type": "text/plain" })), status(415)));
test("UTF-8 byte cap applies without Content-Length", async () => assert.rejects(readJson(request('"가가가가"'), { maxBytes: 10 }), status(413)));
test("declared length cannot bypass streamed byte cap", async () => assert.rejects(readJson(request('"가가가가"', { "Content-Length": "1" }), { maxBytes: 10 }), status(413)));
test("declared oversized body is rejected early", async () => assert.rejects(readJson(request('{}', { "Content-Length": "1000" }), { maxBytes: 50 }), status(413)));
test("malformed Content-Length is rejected", async () => assert.rejects(readJson(request('{}', { "Content-Length": "1e6" })), status(400)));
test("invalid UTF-8 is rejected rather than silently replaced", async () => assert.rejects(readJson(request(new Uint8Array([0xff, 0xfe]))), status(400)));
test("slow request body has a deadline and is cancelled", async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const r = new Request("https://school.example", { method: "POST", body, duplex: "half", headers: { "Content-Type": "application/json" } });
  await assert.rejects(readJson(r, { timeoutMs: 10 }), status(408));
  assert.equal(cancelled, true);
});
test("configured origin is an exact allowlist", () => {
  assert.doesNotThrow(() => requireOrigin(request("{}", { Origin: "https://school.example" }), "https://proxy.example", "https://school.example/"));
});
test("proxy host cannot broaden configured origin", () => assert.throws(() => requireOrigin(request("{}", { Origin: "https://proxy.example" }), "https://proxy.example", "https://school.example"), status(403)));
for (const origin of [undefined, "null", "https://school.example.evil.invalid"]) test(`rejects missing/hostile origin ${origin}`, () => {
  assert.throws(() => requireOrigin(request("{}", origin ? { Origin: origin } : {}), "https://school.example", undefined), status(403));
});
test("invalid origin configuration fails closed", () => assert.throws(() => requireOrigin(request("{}"), "https://school.example", "https://school.example/path"), status(503)));
for (const [message, expected] of [["version_conflict", 409], ["idempotency_conflict", 409], ["rate_limit", 429], ["unauthorized", 401], ["not_found", 404], ["forbidden", 403], ["invalid_input", 422], ["forbidden_transition", 409], ["connection lost with PRIVATE ANSWER", 500]]) {
  test(`DB ${message.split(" ")[0]} is mapped to ${expected}`, () => {
    const error = rpcError({ message }); assert.equal(error.status, expected); assert.ok(!error.message.includes("PRIVATE"));
  });
}
test("unclassified exceptions are sanitized with a trace ID", () => {
  const result = publicFailure(new Error("API_KEY=secret + student text"), "trace-id");
  assert.equal(result.status, 500); assert.equal(result.body.request_id, "trace-id"); assert.ok(!JSON.stringify(result).includes("secret"));
});
test("rate limit response includes Retry-After", () => assert.equal(publicFailure(rpcError({ message: "rate_limit" }), "id").headers["Retry-After"], "60"));
