import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
const accounts = JSON.parse(await readFile(".secrets/accounts.json", "utf8"));
const clients = [];
for (const a of accounts) {
  const c = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } },
  );
  const { error } = await c.auth.signInWithPassword({
    email: a.email,
    password: a.password,
  });
  assert.equal(error, null);
  clients.push(c);
}
const [student, other, teacher, outsider] = clients;
const act = (c, action, id, version, data, request = crypto.randomUUID()) =>
  c.rpc("lab_act", {
    p_action: action,
    p_id: id,
    p_version: version,
    p_data: data,
    p_request: request,
  });
const list = async (c) => {
  const { data, error } = await c.rpc("lab_list");
  assert.equal(error, null);
  return data.records;
};
const req = crypto.randomUUID(),
  input = {
    item: "D01",
    prediction: "나무는 가라앉고 철은 떠요",
    reason: "80g인 나무가 20g인 철보다 무거우니까 나무가 가라앉을 것 같아요.",
  };
const result = await act(student, "submit", null, null, input, req);
assert.equal(result.error, null);
const id = result.data;
assert.equal((await act(student, "submit", null, null, input, req)).data, id);
assert.ok(
  (
    await act(
      student,
      "submit",
      null,
      null,
      { ...input, reason: "다른 이유" },
      req,
    )
  ).error,
);
assert.ok(!(await list(other)).some((r) => r.id === id));
assert.ok(!(await list(outsider)).some((r) => r.id === id));
assert.ok((await student.from("lab_records").select("*")).error);
assert.ok((await student.rpc("lab_experiment", { p_id: id })).error);
assert.ok(
  (
    await act(student, "review", id, 1, {
      decision: "confirm",
      hypothesis: "mass_only",
      experiment: "wood80_iron20",
    })
  ).error,
);
assert.ok((await act(outsider, "review", id, 1, { decision: "hold" })).error);
assert.ok((await act(teacher, "review", id, null, { decision: "hold" })).error);
console.log(
  "PASS: authentication, role isolation, teacher gate, idempotency, nullable version rejected",
);
let r;
for (let n = 0; n < 35; n++) {
  r = (await list(teacher)).find((r) => r.id === id);
  if (r.analysis_mode !== "pending") break;
  await new Promise((r) => setTimeout(r, 3000));
}
assert.equal(r.analysis_mode, "live");
assert.equal(r.hypothesis, "mass_only");
assert.ok(r.analysis_note.length > 0);
console.log(
  "PASS: actual Cursor analysis persisted in Supabase:",
  r.hypothesis,
);
const saved = {
  id,
  mode: r.analysis_mode,
  hypothesis: r.hypothesis,
  note: r.analysis_note,
};
assert.equal(
  (await act(teacher, "review", id, 1, { decision: "hold" })).error,
  null,
);
assert.ok((await student.rpc("lab_experiment", { p_id: id })).error);
assert.equal(
  (
    await act(student, "reason", id, 2, {
      reason: input.reason + " 부피는 비교하지 않았어요.",
    })
  ).error,
  null,
);
assert.ok((await act(teacher, "review", id, 1, { decision: "hold" })).error);
assert.equal(
  (
    await act(teacher, "review", id, 3, {
      decision: "confirm",
      hypothesis: "mass_only",
      experiment: "wood80_iron20",
    })
  ).error,
  null,
);
const exp = await student.rpc("lab_experiment", { p_id: id });
assert.equal(exp.error, null);
assert.equal(exp.data.leftFloats, true);
assert.equal(exp.data.rightFloats, false);
assert.ok((await other.rpc("lab_experiment", { p_id: id })).error);
assert.equal((await act(student, "observe", id, 4, {})).error, null);
assert.ok(
  (await act(student, "revise", id, 5, { text: "밀도를 비교해야 한다" })).error,
);
assert.equal(
  (
    await act(student, "revise", id, 5, {
      text: "질량만으로는 알 수 없고 물체와 액체의 밀도를 비교해야 해요.",
      note: "부피를 놓쳤어요",
      stuck: "observe",
    })
  ).error,
  null,
);
assert.equal(
  (
    await act(student, "reassess", id, 6, {
      prediction: "A는 뜨고 B는 가라앉아요",
      reason:
        "A의 밀도는 0.6이고 B는 3이므로 물의 밀도 1과 비교하면 알 수 있어요.",
    })
  ).error,
  null,
);
assert.ok((await act(teacher, "complete", id, 7, {})).error);
assert.ok(
  (await act(teacher, "complete", id, 7, { scores: [null, 1, 2] })).error,
);
assert.equal(
  (await act(teacher, "complete", id, 7, { scores: [2, 2, 2] })).error,
  null,
);
r = (await list(student)).find((r) => r.id === id);
assert.equal(r.state, "completed");
assert.equal(r.version, 8);
assert.ok(!("hypothesis" in r));
console.log(
  "PASS: hold, resubmit, stale version, approved experiment, revision, transfer case, rubric validation, completion",
);
await writeFile(
  ".secrets/integration-result.json",
  JSON.stringify(
    { ...saved, completed: true, at: new Date().toISOString() },
    null,
    2,
  ),
);
for (const c of clients) await c.auth.signOut({ scope: "local" });
