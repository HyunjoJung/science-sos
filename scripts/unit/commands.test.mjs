import test from "node:test";
import assert from "node:assert/strict";
import { labCommand, spaceCommand, text } from "../../src/lib/runtime/commands.mjs";
const id = "11111111-1111-4111-8111-111111111111", request = "22222222-2222-4222-8222-222222222222";
const lab = (action, data, extra = {}) => ({ action, data, id: action === "submit" ? null : id, version: action === "submit" ? null : 1, request, ...extra });
const space = (action, data, extra = {}) => ({ action, data, id: ["chat_send", "material_add", "topic_add"].includes(action) ? null : id, request, version: null, ...extra });
const submit = () => lab("submit", { item: "D01", prediction: "둘 다 떠요", reason: " 나무가 가벼워요 " });
test("submission is normalized without mutating original payload", () => { const raw = submit(); assert.equal(labCommand(raw).data.reason, "나무가 가벼워요"); assert.equal(raw.data.reason, " 나무가 가벼워요 "); });
test("Unicode codepoint limit permits 300 non-BMP characters", () => assert.equal([...text("😀".repeat(300), 300)].length, 300));
test("301 Unicode codepoints are rejected", () => assert.throws(() => text("😀".repeat(301), 300)));
for (const [label, raw] of [
  ["null body", null], ["array body", []], ["unknown action", lab("execute_sql", {})],
  ["missing request", { ...submit(), request: undefined }], ["invalid request", { ...submit(), request: "id" }],
  ["nullable update version", lab("reason", { reason: "근거" }, { version: null })],
  ["fractional version", lab("reason", { reason: "근거" }, { version: 1.1 })],
  ["submit update id", { ...submit(), id }], ["numeric reason", lab("reason", { reason: 42 })],
  ["blank reason", lab("reason", { reason: "  " })], ["untrusted role", { ...submit(), role: "teacher" }],
  ["null rubric", lab("complete", { scores: null })], ["null rubric cell", lab("complete", { scores: [null, 1, 2] })],
  ["string rubric cell", lab("complete", { scores: ["0", 1, 2] })], ["out of range rubric", lab("complete", { scores: [0, 1, 3] })],
  ["wrong rubric length", lab("complete", { scores: [0, 1] })], ["missing revision stage", lab("revise", { text: "새 설명" })],
]) test(`lab rejects ${label}`, () => assert.throws(() => labCommand(raw)));
test("current teacher form remains compatible for hold", () => {
  const result = labCommand(lab("review", { decision: "hold", hypothesis: "hold", experiment: "guided", question: "왜?", review_note: "메모" }));
  assert.deepEqual(result.data, { decision: "hold", question: "왜?" });
});
test("current teacher form remains compatible for confirm", () => {
  const result = labCommand(lab("review", { decision: "confirm", hypothesis: "other", experiment: "guided", question: "왜?", review_note: "메모" }));
  assert.ok(!("question" in result.data)); assert.equal(result.data.hypothesis, "other");
});
for (const [action, data] of [["reason", { reason: "근거" }], ["observe", {}], ["observe", { observation: "관찰" }], ["revise", { text: "새 설명", note: "", stuck: "none" }], ["reassess", { prediction: "55g", reason: "근거" }], ["complete", { scores: [0, 1, 2] }]]) test(`valid ${action} command`, () => assert.equal(labCommand(lab(action, data)).action, action));
for (const [action, data] of [["material_add", { title: "자료", section: "1절", content: "내용" }], ["material_edit", { enabled: false }], ["feedback_send", { student_id: id, body: "잘했어요" }], ["feedback_read", {}], ["chat_send", { room: "course", question: "왜?" }], ["topic_add", { title: "주제", unit: "수학" }], ["post_add", { body: "생각", parent_id: null }], ["like_toggle", {}]]) test(`valid space ${action}`, () => assert.equal(spaceCommand(space(action, data)).action, action));
for (const [label, value] of [["blank chat", space("chat_send", { room: "course", question: " " })], ["empty edit", space("material_edit", {})], ["invalid parent", space("post_add", { body: "답글", parent_id: "bad" })], ["null body", space("feedback_send", { student_id: id, body: null })], ["invalid room", space("chat_send", { room: "admin", question: "왜?" })], ["string enabled", space("material_edit", { enabled: "false" })]]) test(`space rejects ${label}`, () => assert.throws(() => spaceCommand(value)));
