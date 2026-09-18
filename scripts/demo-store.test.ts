import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoSeed, demoStudents } from "../src/lib/demo-data";
import { items } from "../src/lib/content";
import {
  demoLabAction,
  demoSpaceAction,
  getDemoExperiment,
  getDemoSnapshot,
  resetDemo,
} from "../src/lib/demo-store";

const mainId = "demo-record-D01-01";
const student = () => getDemoSnapshot("student");
const teacher = () => getDemoSnapshot("teacher");
const main = () => student().records.find((r) => r.id === mainId)!;
const approve = () => {
  teacher();
  demoLabAction(
    "review",
    {
      decision: "confirm",
      hypothesis: "mass_only",
      experiment: "wood80_iron20",
    },
    mainId,
  );
};
const storage = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => storage.get(key) || null,
  setItem: vi.fn((key: string, value: string) => {
    storage.set(key, value);
  }),
  removeItem: (key: string) => {
    storage.delete(key);
  },
};
beforeEach(() => {
  storage.clear();
  localStorage.setItem.mockImplementation((key, value) => {
    storage.set(key, value);
  });
  vi.stubGlobal("window", { localStorage });
  resetDemo();
  teacher();
});

describe("isolated presentation fixtures", () => {
  it("contains complete, internally consistent examples across every lesson", () => {
    const seed = createDemoSeed();
    expect(demoStudents).toHaveLength(24);
    expect(seed.records).toHaveLength(192);
    expect(seed.space.materials).toHaveLength(16);
    expect(seed.space.topics).toHaveLength(8);
    expect(seed.space.posts).toHaveLength(40);
    for (const r of seed.records) {
      expect(items.find((i) => i.id === r.item_id)?.choices).toContain(
        r.prediction,
      );
      expect(r.analysis_mode).toBe("sample");
      if (["awaiting_review", "needs_more_reason"].includes(r.state)) {
        expect(r.experiment_id).toBeNull();
        expect(r.observation).toBeNull();
      }
      if (["observed", "revised", "reassessed", "completed"].includes(r.state))
        expect(r.observation).toBeTruthy();
      if (["revised", "reassessed", "completed"].includes(r.state))
        expect(r.revised_text).toBeTruthy();
      if (["reassessed", "completed"].includes(r.state)) {
        const item = items.find((i) => i.id === r.item_id)!;
        expect(items.find((i) => i.id === item.pair)?.choices).toContain(
          r.re_prediction,
        );
        expect(r.re_reason).toBeTruthy();
      }
      if (r.state === "completed") expect(r.scores).toHaveLength(3);
    }
    for (const c of seed.space.chats) {
      expect(c.status).toBe("sample");
      expect(c.answer?.length).toBeGreaterThan(20);
      for (const source of c.sources)
        if (source.quote) {
          const material = seed.space.materials.find(
            (m) => m.title === source.title,
          )!;
          expect(material.content).toContain(source.quote);
        }
    }
  });
  it("filters student records, chat and feedback; returns detached snapshots", () => {
    const snapshot = student();
    expect(snapshot.records).toHaveLength(8);
    expect(
      snapshot.records.every((r) => r.student_id === demoStudents[0].id),
    ).toBe(true);
    expect(
      snapshot.space.chats.every((c) => c.student_id === demoStudents[0].id),
    ).toBe(true);
    expect(
      snapshot.space.feedback.every((f) => f.student_id === demoStudents[0].id),
    ).toBe(true);
    expect(snapshot.space.answers).toEqual({});
    snapshot.records[0].reason = "must not leak";
    expect(main().reason).not.toBe("must not leak");
    expect(teacher().space.members).toHaveLength(24);
  });
  it("enforces teacher approval, ownership and ordering before showing experiments", () => {
    student();
    expect(() => getDemoExperiment(mainId)).toThrow();
    expect(() => demoLabAction("observe", {}, mainId)).toThrow();
    expect(() =>
      demoLabAction(
        "review",
        {
          decision: "confirm",
          hypothesis: "mass_only",
          experiment: "wood80_iron20",
        },
        mainId,
      ),
    ).toThrow();
    expect(() =>
      demoLabAction(
        "reason",
        { reason: "다른 학생의 이유" },
        "demo-record-D01-09",
      ),
    ).toThrow();
    expect(main().state).toBe("awaiting_review");
  });
  it("runs the complete D01 teacher/student demonstration journey", () => {
    approve();
    student();
    expect(getDemoExperiment(mainId).leftFloats).toBe(true);
    demoLabAction("observe", {}, mainId);
    expect(main().observation).toContain("80g 나무");
    demoLabAction(
      "revise",
      {
        text: "물체와 액체의 밀도를 비교해야 해요.",
        note: "무게만 봤어요.",
        stuck: "observe",
      },
      mainId,
    );
    demoLabAction(
      "reassess",
      {
        prediction: "A는 뜨고 B는 가라앉아요",
        reason: "A는 0.6, B는 3g/cm³로 물과 비교했어요.",
      },
      mainId,
    );
    expect(() =>
      demoLabAction("complete", { scores: [2, 2, 2] }, mainId),
    ).toThrow();
    teacher();
    demoLabAction("complete", { scores: [2, 2, 2] }, mainId);
    expect(main().state).toBe("completed");
    expect(main().scores).toEqual([2, 2, 2]);
    expect(main().version).toBe(6);
    expect(() => demoLabAction("observe", {}, mainId)).toThrow();
  });
  it("revokes an assigned experiment on hold and requires reason review again", () => {
    approve();
    teacher();
    demoLabAction(
      "review",
      { decision: "hold", question: "부피도 비교해 볼까요?" },
      mainId,
    );
    expect(main().experiment_id).toBeNull();
    expect(() => getDemoExperiment(mainId)).toThrow();
    demoLabAction(
      "reason",
      { reason: "무게가 무거운 쪽이 가라앉는다고 생각했어요." },
      mainId,
    );
    expect(main().state).toBe("awaiting_review");
    expect(main().hypothesis).toBe("hold");
    teacher();
    expect(() =>
      demoLabAction(
        "review",
        { decision: "edit", hypothesis: "size_only", experiment: "split_wood" },
        mainId,
      ),
    ).toThrow();
    demoLabAction(
      "review",
      {
        decision: "edit",
        hypothesis: "size_only",
        experiment: "split_wood",
        review_note: "부피 언급을 함께 살펴볼게요.",
      },
      mainId,
    );
    expect(main().experiment_id).toBe("split_wood");
  });
  it("never fabricates live AI for new submissions or questions", () => {
    student();
    const result = demoLabAction("submit", {
      item: "D07",
      prediction: "110g",
      reason: "소금도 남아 있어요.",
    });
    const row = student().records.find((r) => r.id === result.id)!;
    expect(row.hypothesis).toBe("hold");
    expect(row.analysis_mode).toBe("sample");
    const chat = demoSpaceAction("chat_send", {
      room: "course",
      question: "밀도",
    });
    const c = student().space.chats.find((c) => c.id === chat.id)!;
    expect(c.status).toBe("sample");
    expect(c.answer).toContain("수업 자료를 찾았어요");
    const source = c.sources[0];
    expect(
      student().space.materials.find((m) => m.title === source.title)?.content,
    ).toContain(source.quote);
    const external = demoSpaceAction("chat_send", {
      room: "external",
      question: "오늘 달은 어떤 모양인가요?",
    });
    expect(
      student().space.chats.find((c) => c.id === external.id)?.answer,
    ).toContain("새 외부 검색은 실행하지 않아요");
  });
  it("supports materials, feedback read receipt and isolated role ownership", () => {
    const mat = demoSpaceAction("material_add", {
      title: "추가 비교 자료",
      section: "D01",
      content: "비교할 조건을 적어요.",
    });
    demoSpaceAction(
      "material_edit",
      { enabled: false, content: "수정한 비교 조건" },
      mat.id,
    );
    expect(
      teacher().space.materials.find((m) => m.id === mat.id)?.enabled,
    ).toBe(false);
    const feedback = demoSpaceAction(
      "feedback_send",
      {
        student_id: demoStudents[0].id,
        body: "부피까지 비교한 점을 확인했어요.",
      },
      mainId,
    );
    getDemoSnapshot("student", demoStudents[1].id);
    expect(() => demoSpaceAction("feedback_read", {}, feedback.id)).toThrow();
    student();
    demoSpaceAction("feedback_read", {}, feedback.id);
    expect(
      student().space.feedback.find((f) => f.id === feedback.id)?.read_at,
    ).toBeTruthy();
    expect(() =>
      demoSpaceAction("material_add", {
        title: "학생 자료",
        content: "허용되지 않음",
      }),
    ).toThrow();
  });
  it("persists discussion replies and tracks each participant's likes independently", () => {
    student();
    const topic = demoSpaceAction("topic_add", {
      title: "조건을 하나만 바꾼다면?",
      unit: "질량과 밀도",
    });
    const post = demoSpaceAction(
      "post_add",
      { body: "액체를 바꿔 보고 싶어요.", parent_id: null },
      topic.id,
    );
    teacher();
    demoSpaceAction(
      "post_add",
      { body: "물체는 그대로 두면 좋겠어요.", parent_id: post.id },
      topic.id,
    );
    demoSpaceAction("like_toggle", {}, post.id);
    expect(teacher().space.posts.find((p) => p.id === post.id)?.liked).toBe(
      true,
    );
    student();
    expect(student().space.posts.find((p) => p.id === post.id)?.mine).toBe(
      true,
    );
    expect(student().space.posts.find((p) => p.id === post.id)?.liked).toBe(
      false,
    );
    demoSpaceAction("like_toggle", {}, post.id);
    expect(student().space.posts.find((p) => p.id === post.id)?.likes).toBe(2);
    demoSpaceAction("like_toggle", {}, post.id);
    expect(student().space.posts.find((p) => p.id === post.id)?.likes).toBe(1);
  });
  it("writes only namespaced local storage and reset restores the original journey", () => {
    approve();
    expect([...storage.keys()]).toEqual(["science-sos:presentation-demo:v1"]);
    expect(
      JSON.parse(storage.values().next().value!).records.find(
        (r: { id: string }) => r.id === mainId,
      ).state,
    ).toBe("experiment_assigned");
    resetDemo();
    expect(main().state).toBe("awaiting_review");
    expect(teacher().records).toHaveLength(192);
  });
  it("updates old wording without removing saved work or class data", () => {
    approve();
    const key = "science-sos:presentation-demo:v1";
    const saved = JSON.parse(storage.get(key)!);
    saved.records[0].initial_note = "내가 직접 남긴 질문을 유지해 주세요.";
    saved.space.feedback[0].body =
      "【발표용 예시 피드백】 조건을 잘 비교했어요.";
    saved.space.chats[0].answer =
      "【준비된 예시 답변 · 실시간 AI 아님】 밀도를 비교해요.";
    storage.set(key, JSON.stringify(saved));
    const updated = teacher();
    expect(updated.records).toHaveLength(saved.records.length);
    expect(updated.space.chats).toHaveLength(saved.space.chats.length);
    expect(updated.space.feedback).toHaveLength(saved.space.feedback.length);
    expect(updated.records[0].id).toBe(saved.records[0].id);
    expect(updated.records[0].state).toBe("experiment_assigned");
    expect(updated.records[0].initial_note).toBe(
      "내가 직접 남긴 질문을 유지해 주세요.",
    );
    expect(updated.space.feedback[0].body).toBe("조건을 잘 비교했어요.");
    expect(updated.space.chats[0].answer).toBe("밀도를 비교해요.");
  });
  it("keeps working in memory when browser storage runs out of space", () => {
    localStorage.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    approve();
    expect(main().state).toBe("experiment_assigned");
    demoLabAction("observe", {}, mainId);
    expect(main().state).toBe("observed");
    resetDemo();
    expect(main().state).toBe("awaiting_review");
  });
});
