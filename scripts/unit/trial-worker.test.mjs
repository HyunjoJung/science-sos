import test from "node:test";
import assert from "node:assert/strict";
import { runTrialJob } from "../trial-worker.mjs";

const job = { id: "job-1", lease: "lease-1", prediction: "둘 다 떠요", reason: "나무가 더 무거워요" };
const proposal = { hypothesis: "mass_only", reason_status: "supported", evidence: "더 무거워요", note: "조건을 비교해 주세요." };

test("trial worker persists real inference with fixed science context and original lease", async () => {
  const calls = [];
  const result = await runTrialJob({ job, infer: async (input) => {
    assert.equal(input.reason, job.reason);
    assert.match(input.conditions, /80g\/100cm³/);
    return proposal;
  }, rpc: async (name, args) => { calls.push({ name, args }); return { data: true, error: null }; } });
  assert.deepEqual(result, { generated: true, outcome: "applied" });
  assert.deepEqual(calls, [{ name: "trial_finish", args: { p_id: job.id, p_lease: job.lease, p_result: proposal, p_error: false } }]);
});

test("trial inference failure stores only error, with no substitute hypothesis", async () => {
  let saved;
  const result = await runTrialJob({ job, infer: async () => { throw new Error("private provider detail"); },
    rpc: async (_name, args) => { saved = args; return { data: true, error: null }; } });
  assert.deepEqual(result, { generated: false, outcome: "applied" });
  assert.deepEqual(saved, { p_id: job.id, p_lease: job.lease, p_result: null, p_error: true });
});

test("lost completion acknowledgement does not retry inference or overwrite the answer", async () => {
  let inferenceCalls = 0, writes = 0;
  const result = await runTrialJob({ job, infer: async () => { inferenceCalls++; return proposal; },
    rpc: async () => { writes++; throw new Error("connection dropped"); } });
  assert.deepEqual(result, { generated: true, outcome: "unconfirmed" });
  assert.equal(inferenceCalls, 1);
  assert.equal(writes, 1);
});

test("stale trial lease is reported instead of claiming persisted success", async () => {
  const result = await runTrialJob({ job, infer: async () => proposal,
    rpc: async () => ({ data: false, error: null }) });
  assert.deepEqual(result, { generated: true, outcome: "stale" });
});
