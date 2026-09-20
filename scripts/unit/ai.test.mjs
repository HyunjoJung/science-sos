import test from "node:test";
import assert from "node:assert/strict";
import { validateEvidence, finishOutcome, persistCompletion, completeLegacyJob, retrieveChunks, courseSources } from "../../src/lib/runtime/ai.mjs";
const reason = "80g 나무가 더 무거우니까 가라앉아요.";
const proposal = { hypothesis: "mass_only", reason_status: "contradictory", evidence: "더 무거우니까" };
test("verbatim evidence supports a hypothesis contract", () => assert.equal(validateEvidence(proposal, reason), proposal));
for (const [label, value] of [["fabricated quote", { ...proposal, evidence: "가벼우니까" }], ["empty quote", { ...proposal, evidence: "" }], ["whitespace quote", { ...proposal, evidence: " " }], ["insufficient evidence", { ...proposal, reason_status: "insufficient" }]]) test(`rejects ${label}`, () => assert.throws(() => validateEvidence(value, reason)));
test("hold can abstain without fabricated evidence", () => assert.doesNotThrow(() => validateEvidence({ hypothesis: "hold", reason_status: "insufficient", evidence: "" }, reason)));
test("RPC true is applied", () => assert.equal(finishOutcome({ data: true, error: null }), "applied"));
test("RPC false is stale, never success", () => assert.equal(finishOutcome({ data: false, error: null }), "stale"));
for (const data of [null, {}, "true", 1]) test(`non-boolean RPC result ${JSON.stringify(data)} is rejected`, () => assert.throws(() => finishOutcome({ data, error: null })));
test("RPC error is not an acknowledgement", () => assert.throws(() => finishOutcome({ data: true, error: { message: "connection reset" } })));
test("lost DB acknowledgement never triggers an error overwrite", async () => {
  const calls = [];
  const result = await persistCompletion(async (name, args) => { calls.push({ name, args }); throw Error("ack lost after commit"); }, "lab_ai_finish", { p_note: "valid inference", p_mode: "live" });
  assert.equal(result, "unconfirmed"); assert.equal(calls.length, 1); assert.equal(calls[0].args.p_mode, "live");
});
test("persistence distinguishes stale leases", async () => assert.equal(await persistCompletion(async () => ({ data: false, error: null }), "lab_chat_finish", {}), "stale"));
for (const name of ["lab_ai_finish", "lab_chat_finish"]) {
  test(`${name}: a lost acknowledgement never persists the error fallback`, async () => {
    const calls = [];
    const success = { p_note: "accepted generated answer", p_mode: "live" };
    const result = await completeLegacyJob({ name, generate: async () => success,
      fallback: { p_mode: "error" }, rpc: async (method, args) => {
        calls.push({ method, args }); throw Error("acknowledgement lost after commit");
      } });
    assert.deepEqual(result, { generated: true, outcome: "unconfirmed" });
    assert.deepEqual(calls, [{ method: name, args: success }]);
  });
}
test("a stale completion is never reported as applied", async () => {
  const result = await completeLegacyJob({ name: "lab_ai_finish", generate: async () => ({ p_mode: "live" }),
    fallback: { p_mode: "error" }, rpc: async () => ({ data: false, error: null }) });
  assert.deepEqual(result, { generated: true, outcome: "stale" });
});
test("invalid analysis persists the direct-review fallback once", async () => {
  const calls = [], fallback = { p_mode: "error", p_hypothesis: "hold" };
  const result = await completeLegacyJob({ name: "lab_ai_finish", fallback,
    generate: async () => { validateEvidence({ ...proposal, evidence: "" }, reason); return { p_mode: "live" }; },
    rpc: async (name, args) => { calls.push(args); return { data: true, error: null }; } });
  assert.deepEqual(result, { generated: false, outcome: "applied" });
  assert.deepEqual(calls, [fallback]);
});
const source = { id: "material-1", title: "과학 자료", section: "4절", content: "서론 ".repeat(1800) + "달걀은 밀도가 큰 소금물에서 뜬다." };
test("retrieval can find evidence well beyond character 3000", () => {
  const chunks = retrieveChunks("달걀 소금물", [source]); assert.ok(chunks.length); assert.ok(chunks[0].start > 3000); assert.ok(chunks[0].content.includes("달걀"));
});
test("title match without body evidence is not sent as support", () => assert.deepEqual(retrieveChunks("소금물", [{ id: "x", title: "소금물", content: "전혀 다른 내용" }]), []));
test("irrelevant body produces no candidate instead of first-page filler", () => assert.deepEqual(retrieveChunks("천문학", [source]), []));
test("selected chunk identifiers are unique and offsets reproduce original content", () => {
  const chunks = retrieveChunks("밀도", [{ ...source, content: ("밀도 " + "본문 ".repeat(500)).repeat(5) }]);
  assert.equal(new Set(chunks.map((c) => c.id)).size, chunks.length);
  const content = ("밀도 " + "본문 ".repeat(500)).repeat(5);
  for (const c of chunks) assert.equal(content.slice(c.start, c.end), c.content);
});
test("chunk boundaries do not split emoji surrogate pairs", () => {
  const content = ("소금물😀😀😀 ").repeat(40);
  const chunks = retrieveChunks("소금물", [{ id: "x", title: "자료", content }], { chunkSize: 11, overlap: 2, limit: 10 });
  for (const chunk of chunks) { assert.equal(chunk.content.isWellFormed(), true); assert.equal(content.slice(chunk.start, chunk.end), chunk.content); }
});
test("invalid chunk windows fail instead of looping forever", () => assert.throws(() => retrieveChunks("소금물", [source], { chunkSize: 20, overlap: 20 })));
test("verified citation stores document-relative offsets", () => {
  const chunks = retrieveChunks("달걀 소금물", [source]), quote = "달걀은 밀도가 큰 소금물에서 뜬다.";
  const citations = courseSources({ supported: true, links: [], citations: [{ id: chunks[0].id, quote }] }, chunks);
  assert.equal(citations[0].material_id, source.id); assert.equal(source.content.slice(citations[0].start, citations[0].end), quote);
});
for (const [label, result] of [
  ["support with no citations", { supported: true, links: [], citations: [] }],
  ["course links", { supported: false, links: ["made-up"], citations: [] }],
  ["unsupported answer with citation", { supported: false, links: [], citations: [{ id: "x", quote: "fake" }] }],
  ["wrong material id", { supported: true, links: [], citations: [{ id: "x", quote: "fake" }] }],
]) test(`rejects ${label}`, () => assert.throws(() => courseSources(result, retrieveChunks("달걀", [source]))));
test("duplicate citations are rejected", () => {
  const chunks = retrieveChunks("달걀", [source]), c = { id: chunks[0].id, quote: "달걀" };
  assert.throws(() => courseSources({ supported: true, links: [], citations: [c, c] }, chunks));
});
