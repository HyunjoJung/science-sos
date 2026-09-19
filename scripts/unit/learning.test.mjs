import test from "node:test";
import assert from "node:assert/strict";
import { defineContentPack, nextProposal, transition } from "../../src/lib/learning/workflow.mjs";
// Synthetic engineering fixtures, NOT verified national-curriculum content.
const teacher = { userId: "teacher", role: "teacher", classIds: ["class-1"] };
const student = { userId: "student", role: "student", classIds: ["class-1"] };
const pack = (subject = "science", kind = "simulation") => defineContentPack({ id: `${subject}-test`, subject, version: "1.0.0", activities: [{ id: "activity-1", kind, approved: true }, { id: "draft", kind, approved: false }] });
const record = (p = pack()) => ({ id: "record-1", classId: "class-1", studentId: "student", packId: p.id, packVersion: p.version, version: 1, stage: "awaiting_review" });
const cmd = (r, action, more = {}) => ({ recordId: r.id, expectedVersion: r.version, action, ...more });
for (const [subject, kind] of [["science", "simulation"], ["mathematics", "contrast_examples"], ["reading", "source_comparison"]]) {
  test(`${subject} runs the same end-to-end pure state machine`, () => {
    const p = pack(subject, kind); let r = record(p);
    r = transition(r, cmd(r, "assign_activity", { activityId: "activity-1" }), teacher, p);
    r = transition(r, cmd(r, "complete_activity"), student, p);
    r = transition(r, cmd(r, "submit_transfer"), student, p);
    r = transition(r, cmd(r, "complete"), teacher, p);
    assert.equal(r.stage, "completed"); assert.equal(r.version, 5); assert.equal(r.packVersion, "1.0.0");
  });
}
test("understood answer skips remediation but still needs transfer and teacher completion", () => {
  const p = pack(), initial = record(p);
  let r = transition(initial, cmd(initial, "confirm_understanding"), teacher, p);
  assert.equal(r.stage, "awaiting_transfer"); assert.equal(r.activityId, null); assert.equal(initial.stage, "awaiting_review");
  r = transition(r, cmd(r, "submit_transfer"), student, p); r = transition(r, cmd(r, "complete"), teacher, p); assert.equal(r.stage, "completed");
});
test("clarification reopens review without an automatic diagnosis", () => {
  const p = pack(); let r = record(p); r = transition(r, cmd(r, "request_clarification"), teacher, p); r = transition(r, cmd(r, "resubmit"), student, p); assert.equal(r.stage, "awaiting_review");
});
for (const [label, actor] of [["other student", { ...student, userId: "other" }], ["other class teacher", { ...teacher, classIds: ["class-2"] }], ["model claiming admin", { ...teacher, role: "admin" }]]) test(`denies ${label}`, () => { const p = pack(), r = record(p); assert.throws(() => transition(r, cmd(r, "confirm_understanding"), actor, p)); });
test("student cannot approve their own understanding", () => { const p = pack(), r = record(p); assert.throws(() => transition(r, cmd(r, "confirm_understanding"), student, p)); });
test("draft activity cannot be assigned", () => { const p = pack(), r = record(p); assert.throws(() => transition(r, cmd(r, "assign_activity", { activityId: "draft" }), teacher, p)); });
test("unknown activity cannot be assigned", () => { const p = pack(), r = record(p); assert.throws(() => transition(r, cmd(r, "assign_activity", { activityId: "invented" }), teacher, p)); });
for (const version of [null, 0, 2, 1.5]) test(`rejects stale/malformed expected version ${version}`, () => { const p = pack(), r = record(p); assert.throws(() => transition(r, { ...cmd(r, "confirm_understanding"), expectedVersion: version }, teacher, p)); });
test("a new pack revision cannot silently change an in-progress record", () => { const p = pack(), r = record(p); assert.throws(() => transition(r, cmd(r, "confirm_understanding"), teacher, { ...p, version: "2.0.0" })); });
test("unknown/prototype command cannot select a transition", () => { const p = pack(), r = record(p); assert.throws(() => transition(r, cmd(r, "__proto__"), teacher, p)); });
test("published pack snapshot cannot be mutated through input references", () => {
  const input = { id: "test", subject: "language", version: "1.0.0", activities: [{ id: "a", kind: "guided", approved: false }] };
  const p = defineContentPack(input); input.activities[0].approved = true; assert.equal(p.activities[0].approved, false); assert.throws(() => { p.activities[0].approved = true; });
});
test("duplicate activity IDs are rejected", () => assert.throws(() => defineContentPack({ id: "test", subject: "math", version: "1.0.0", activities: [{ id: "a", kind: "guided", approved: false }, { id: "a", kind: "guided", approved: true }] })));
const understood = { ruleVerdict: "correct", evidence: "supported", interpretation: "understood", runStatus: "succeeded" };
test("normal understanding proposes a transfer check, not correction", () => assert.equal(nextProposal(understood).kind, "transfer_check"));
for (const runStatus of ["failed", "pending"]) test(`${runStatus} AI run is operational, not an educational diagnosis`, () => assert.equal(nextProposal({ ...understood, runStatus }).kind, "operational_review"));
test("correct choice alone with no explanation calls for clarification", () => assert.equal(nextProposal({ ...understood, evidence: "insufficient" }).kind, "clarification"));
test("model interpretation conflicting with rule verdict is not accepted", () => assert.equal(nextProposal({ ...understood, ruleVerdict: "incorrect" }).kind, "conflicting_evidence_review"));
for (const interpretation of ["out_of_scope", "ambiguous_item"]) test(`${interpretation} returns item review`, () => assert.equal(nextProposal({ ...understood, interpretation }).kind, "item_review"));
test("unknown interpretation fails closed", () => assert.throws(() => nextProposal({ ...understood, interpretation: "looks_ok" })));
