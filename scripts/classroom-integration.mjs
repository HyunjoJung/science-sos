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
  assert.equal(
    (await c.auth.signInWithPassword({ email: a.email, password: a.password }))
      .error,
    null,
  );
  clients.push(c);
}
const [student, other, teacher, outsider] = clients;
const act = (c, action, data = {}, id = null, request = crypto.randomUUID()) =>
  c.rpc("lab_space_act", {
    p_action: action,
    p_data: data,
    p_id: id,
    p_request: request,
  });
const space = async (c) => {
  const { data, error } = await c.rpc("lab_space");
  assert.equal(error, null);
  return data;
};
const lab = (c, action, id, version, data) =>
  c.rpc("lab_act", {
    p_action: action,
    p_id: id,
    p_version: version,
    p_data: data,
    p_request: crypto.randomUUID(),
  });
const material = {
  title: "밀도 수업 노트 · 연동 검증",
  section: "물질의 특성 / 밀도",
  content:
    "밀도는 단위 부피당 질량이다. 밀도 = 질량 ÷ 부피로 구한다. 같은 물질은 온도와 압력 등 조건이 같으면 크기가 달라도 밀도가 같다. 속이 빈 부분이 없는 물체는 밀도가 액체보다 작으면 뜨고 크면 가라앉는다.",
};
assert.ok((await act(student, "material_add", material)).error);
const mr = await act(teacher, "material_add", material);
assert.equal(mr.error, null);
const mid = mr.data;
assert.ok(!(await space(outsider)).materials.some((m) => m.id === mid));
assert.ok(
  (await act(outsider, "material_edit", { enabled: false }, mid)).error,
);
assert.equal(
  (await act(teacher, "material_edit", { enabled: false }, mid)).error,
  null,
);
assert.ok(!(await space(student)).materials.some((m) => m.id === mid));
assert.equal(
  (await act(teacher, "material_edit", { enabled: true }, mid)).error,
  null,
);
const fr = await act(teacher, "feedback_send", {
  student_id: accounts[0].id,
  body: "질량뿐 아니라 부피도 함께 비교해 설명을 바꾼 점을 확인했어요. 같은 나무를 나누면 밀도는 어떻게 될까요?",
});
assert.equal(fr.error, null);
assert.ok(!(await space(other)).feedback.some((f) => f.id === fr.data));
assert.ok((await act(other, "feedback_read", {}, fr.data)).error);
assert.equal((await act(student, "feedback_read", {}, fr.data)).error, null);
assert.ok(
  (await space(teacher)).feedback.find((f) => f.id === fr.data).read_at,
);
const tr = await act(teacher, "topic_add", {
  title: "무거운 물체는 언제나 가라앉을까요? · 연동 검증",
  unit: "물질의 특성",
});
assert.equal(tr.error, null);
assert.ok(
  (await act(outsider, "post_add", { body: "접근 불가" }, tr.data)).error,
);
const pr = await act(
  student,
  "post_add",
  {
    body: "물체의 질량과 부피를 함께 비교해야 한다고 생각해요.",
    parent_id: null,
  },
  tr.data,
);
assert.equal(pr.error, null);
assert.equal(
  (
    await act(
      teacher,
      "post_add",
      {
        body: "좋아요. 액체의 밀도도 함께 비교하면 어떨까요?",
        parent_id: pr.data,
      },
      tr.data,
    )
  ).error,
  null,
);
const likeRequest = crypto.randomUUID();
assert.equal(
  (await act(other, "like_toggle", {}, pr.data, likeRequest)).error,
  null,
);
assert.equal(
  (await act(other, "like_toggle", {}, pr.data, likeRequest)).error,
  null,
);
assert.equal(
  (await space(student)).posts.find((p) => p.id === pr.data).likes,
  1,
);
console.log(
  "PASS: material permissions and enable switch, private feedback and read receipt, class-only topics, replies, idempotent appreciation",
);
const cr = await act(student, "chat_send", {
  room: "course",
  question:
    "같은 나무를 반으로 잘라도 밀도가 같나요? 자료를 근거로 설명해 주세요.",
});
assert.equal(cr.error, null);
assert.ok(!(await space(other)).chats.some((c) => c.id === cr.data));
assert.ok(!(await space(outsider)).chats.some((c) => c.id === cr.data));
let chat;
for (let n = 0; n < 40; n++) {
  chat = (await space(teacher)).chats.find((c) => c.id === cr.data);
  if (["ready", "error"].includes(chat.status)) break;
  await new Promise((r) => setTimeout(r, 3000));
}
assert.equal(chat.status, "ready");
assert.ok(chat.sources.some((s) => material.content.includes(s.quote)));
assert.ok(chat.answer);
console.log(
  "PASS: actual Cursor chat with verified quotation; teacher history; private student conversation",
);
const record = await lab(student, "submit", null, null, {
  item: "D07",
  prediction: "100g",
  reason: "소금이 녹아서 없어지니까 물의 질량만 남는다고 생각했어요.",
  stuck: "이유 설명",
  note: "녹는 것과 사라지는 것이 같은지 궁금해요.",
  difficult: false,
});
assert.equal(record.error, null);
assert.equal(
  (
    await lab(teacher, "review", record.data, 1, {
      decision: "hold",
      question: "눈에 보이지 않는 소금은 어디에 있을까요?",
    })
  ).error,
  null,
);
const held = (await student.rpc("lab_list")).data.records.find(
  (r) => r.id === record.data,
);
assert.equal(held.teacher_question, "눈에 보이지 않는 소금은 어디에 있을까요?");
assert.equal(held.initial_stuck, "이유 설명");
assert.equal(
  (
    await lab(student, "reason", record.data, 2, {
      reason: "소금이 물속에 남아 있다면 전체 질량은 그대로일 것 같아요.",
    })
  ).error,
  null,
);
assert.ok(
  (
    await lab(teacher, "review", record.data, 3, {
      decision: "confirm",
      hypothesis: "other",
      experiment: "wood80_iron20",
    })
  ).error,
);
assert.equal(
  (
    await lab(teacher, "review", record.data, 3, {
      decision: "edit",
      hypothesis: "other",
      experiment: "guided",
      review_note: "용해와 소멸의 구분을 확인합니다.",
    })
  ).error,
  null,
);
assert.equal(
  (await student.rpc("lab_experiment", { p_id: record.data })).data.id,
  "guided",
);
assert.ok((await lab(student, "observe", record.data, 4, {})).error);
assert.equal(
  (
    await lab(student, "observe", record.data, 4, {
      observation:
        "밀폐 용기의 전체 질량을 비교하니 소금이 녹기 전후 같았습니다.",
    })
  ).error,
  null,
);
console.log(
  "PASS: extended lesson, personalized hold question, appropriate activity gate, student-entered observation",
);
await writeFile(
  ".secrets/classroom-result.json",
  JSON.stringify(
    {
      material: mid,
      feedback: fr.data,
      topic: tr.data,
      chat: cr.data,
      record: record.data,
      at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
for (const c of clients) await c.auth.signOut({ scope: "local" });
