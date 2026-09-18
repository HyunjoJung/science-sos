"use client";

import {
  items,
  hypotheses,
  experiments,
  type RecordRow,
  type Hypothesis,
} from "./content";
import {
  createDemoSeed,
  DEMO_SCHEMA,
  DEMO_TEACHER_ID,
  demoExperiments,
  demoStudents,
  type DemoState,
  type DemoExperiment,
} from "./demo-data";
import type { Space } from "../components/ClassroomPanels";

export { demoStudents } from "./demo-data";
const STORAGE_KEY = "science-sos:presentation-demo:v1";
type Role = "teacher" | "student";
let actor: { role: Role; id: string } = {
  role: "teacher",
  id: DEMO_TEACHER_ID,
};
let memory: DemoState | null = null;
let storageWriteFailed = false;
const copy = <T>(value: T): T => structuredClone(value);
function state(): DemoState {
  if (storageWriteFailed && memory) return copy(memory);
  if (typeof window !== "undefined") {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as DemoState;
        if (
          parsed.schema === DEMO_SCHEMA &&
          Array.isArray(parsed.records) &&
          parsed.space &&
          [
            "materials",
            "feedback",
            "chats",
            "topics",
            "posts",
            "members",
          ].every((key) => Array.isArray(parsed.space[key as keyof Space]))
        )
          return parsed;
      }
    } catch {
      /* A blocked browser storage still permits a session in memory. */
    }
  }
  if (!memory) memory = createDemoSeed();
  return copy(memory);
}
function save(next: DemoState) {
  memory = copy(next);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      storageWriteFailed = true; /* Retain newest state until this page closes. */
    }
  }
}
function requireRole(role: Role) {
  if (actor.role !== role)
    throw Error(
      role === "teacher"
        ? "선생님 화면에서 확인해 주세요."
        : "학생 화면에서 진행해 주세요.",
    );
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || !value || Array.isArray(value))
    throw Error("입력 내용을 확인해 주세요.");
  return value as Record<string, unknown>;
}
function text(
  data: Record<string, unknown>,
  key: string,
  max: number,
  optional = false,
): string {
  const value = data[key];
  if (optional && (value === undefined || value === null)) return "";
  if (
    typeof value !== "string" ||
    (!optional && !value.trim()) ||
    value.length > max
  )
    throw Error(
      `입력한 ${key} 내용을 확인해 주세요. 최대 ${max}자까지 사용할 수 있어요.`,
    );
  return value.trim();
}
function findRecord(s: DemoState, id?: string): RecordRow {
  const r = s.records.find((row) => row.id === id);
  if (!r || (actor.role === "student" && r.student_id !== actor.id))
    throw Error("현재 학생의 기록을 찾을 수 없어요.");
  return r;
}
function inStage(r: RecordRow, stages: string[]) {
  if (!stages.includes(r.state))
    throw Error(
      "현재 단계에서는 이 활동을 진행할 수 없어요. 이전 단계를 확인해 주세요.",
    );
}
const now = () => new Date().toISOString();
const nextId = (kind: string) => `demo-${kind}-${crypto.randomUUID()}`;

/** Sets this tab's demo actor and returns only that actor's visible sample records. */
export function getDemoSnapshot(role: Role, studentId?: string) {
  if (role !== "teacher" && role !== "student")
    throw Error("시연 역할을 확인해 주세요.");
  const student = demoStudents.find(
    (s) => s.id === (studentId || demoStudents[0].id),
  );
  if (role === "student" && !student)
    throw Error("시연 학생을 찾을 수 없어요.");
  actor = { role, id: role === "teacher" ? DEMO_TEACHER_ID : student!.id };
  const s = state();
  const visible = (id: string) => role === "teacher" || id === actor.id;
  const space: Space = {
    ...s.space,
    feedback: s.space.feedback.filter((f) => visible(f.student_id)),
    chats: s.space.chats.filter((c) => visible(c.student_id)),
    members: role === "teacher" ? [...demoStudents] : [student!],
    answers: role === "teacher" ? s.space.answers : {},
    posts: s.space.posts.map((p) => ({
      id: p.id,
      topic_id: p.topic_id,
      parent_id: p.parent_id,
      author: p.author,
      is_teacher: p.is_teacher,
      body: p.body,
      created_at: p.created_at,
      mine: p.author_id === actor.id,
      likes: p.liked_by.length,
      liked: p.liked_by.includes(actor.id),
    })),
  };
  return copy({
    member: {
      user_id: actor.id,
      alias: role === "teacher" ? "과학 선생님" : student!.alias,
      role,
      class_id: "demo-class-2-3",
    },
    records: s.records.filter((r) => visible(r.student_id)),
    space,
  });
}

/** This function provides only approved sample experiments and never calls an API. */
export function getDemoExperiment(id: string): DemoExperiment {
  const r = findRecord(state(), id);
  inStage(r, [
    "experiment_assigned",
    "observed",
    "revised",
    "reassessed",
    "completed",
  ]);
  const e = r.experiment_id && demoExperiments[r.experiment_id];
  if (!e) throw Error("선생님이 다음 활동을 먼저 확인해야 해요.");
  return copy(e);
}

export function resetDemo() {
  save(createDemoSeed());
}

export function demoLabAction(
  action: string,
  input: unknown,
  id?: string,
): { id?: string } {
  const data = object(input),
    s = state();
  let r: RecordRow;
  if (action === "submit") {
    requireRole("student");
    const itemId = text(data, "item", 30),
      item = items.find((i) => i.id === itemId && i.pair);
    const prediction = text(data, "prediction", 150),
      reason = text(data, "reason", 300);
    if (!item || !item.choices.includes(prediction))
      throw Error("수업 문항과 예측한 결과를 확인해 주세요.");
    r = {
      id: nextId("record"),
      student_id: actor.id,
      student_alias: demoStudents.find((x) => x.id === actor.id)!.alias,
      item_id: itemId,
      prediction,
      reason,
      version: 1,
      state: "awaiting_review",
      hypothesis: "hold",
      analysis_mode: "sample",
      analysis_note:
        "시연에서 새로 작성한 이유입니다. 실시간 AI 분석은 실행하지 않았어요. 선생님이 원문을 읽고 가설을 선택해 주세요.",
      experiment_id: null,
      observation: null,
      revised_text: null,
      self_note: null,
      stuck_at: null,
      re_prediction: null,
      re_reason: null,
      scores: null,
      created_at: now(),
      updated_at: now(),
      initial_stuck: text(data, "stuck", 100, true),
      initial_note: text(data, "note", 300, true),
      difficult: data.difficult === true,
    };
    s.records.unshift(r);
    save(s);
    return { id: r.id };
  }
  r = findRecord(s, id);
  switch (action) {
    case "review": {
      requireRole("teacher");
      inStage(r, [
        "awaiting_review",
        "needs_more_reason",
        "experiment_assigned",
      ]);
      const decision = text(data, "decision", 20);
      if (decision === "hold") {
        r.teacher_question =
          text(data, "question", 500, true) ||
          "어떤 조건을 보고 그렇게 생각했나요? 이유를 조금 더 설명해 주세요.";
        r.state = "needs_more_reason";
        r.experiment_id = null;
      } else if (decision === "confirm" || decision === "edit") {
        const h = text(data, "hypothesis", 30) as Hypothesis,
          e = text(data, "experiment", 40);
        if (
          !(h in hypotheses) ||
          h === "hold" ||
          !experiments.some((x) => x.id === e)
        )
          throw Error("가설과 다음 활동을 선택해 주세요.");
        if (!["D01", "D02", "D03"].includes(r.item_id) && e !== "guided")
          throw Error("이 단원에서는 조건 비교 활동을 선택해 주세요.");
        const note = text(data, "review_note", 300, true);
        if (decision === "edit" && !note)
          throw Error("가설을 수정한 이유를 남겨 주세요.");
        r.hypothesis = h;
        r.experiment_id = e;
        r.review_note =
          note || "시연 교사 확인 · 학생의 이유와 다음 활동을 확인했습니다.";
        r.state = "experiment_assigned";
      } else throw Error("확인·수정·보류 중 하나를 선택해 주세요.");
      break;
    }
    case "reason":
      requireRole("student");
      inStage(r, ["needs_more_reason"]);
      r.reason = text(data, "reason", 300);
      r.state = "awaiting_review";
      r.hypothesis = "hold";
      r.experiment_id = null;
      r.analysis_mode = "sample";
      r.analysis_note =
        "시연에서 보완한 이유입니다. 실시간 AI 재분석 없이 선생님이 직접 확인해 주세요.";
      break;
    case "observe":
      requireRole("student");
      inStage(r, ["experiment_assigned"]);
      if (!r.experiment_id || !demoExperiments[r.experiment_id])
        throw Error("선생님이 다음 활동을 먼저 확인해야 해요.");
      r.observation =
        r.experiment_id === "guided"
          ? text(data, "observation", 500)
          : demoExperiments[r.experiment_id].result;
      r.state = "observed";
      break;
    case "revise": {
      requireRole("student");
      inStage(r, ["observed"]);
      const value = text(data, "text", 300),
        note = text(data, "note", 200, true),
        stuck = text(data, "stuck", 30);
      if (!["none", "predict", "observe", "rewrite"].includes(stuck))
        throw Error("생각이 막힌 단계를 선택해 주세요.");
      r.revised_text = value;
      r.self_note = note;
      r.stuck_at = stuck;
      r.state = "revised";
      break;
    }
    case "reassess": {
      requireRole("student");
      inStage(r, ["revised"]);
      const original = items.find((i) => i.id === r.item_id),
        transfer = items.find((i) => i.id === original?.pair);
      const prediction = text(data, "prediction", 150),
        reason = text(data, "reason", 300);
      if (!transfer?.choices.includes(prediction))
        throw Error("새 사례의 예측 결과를 선택해 주세요.");
      r.re_prediction = prediction;
      r.re_reason = reason;
      r.state = "reassessed";
      break;
    }
    case "complete": {
      requireRole("teacher");
      inStage(r, ["reassessed"]);
      if (
        !Array.isArray(data.scores) ||
        data.scores.length !== 3 ||
        data.scores.some((n) => !Number.isInteger(n) || n < 0 || n > 2)
      )
        throw Error("세 가지 준거를 0~2점으로 확인해 주세요.");
      r.scores = [...data.scores] as number[];
      r.state = "completed";
      break;
    }
    default:
      throw Error("지원하지 않는 시연 활동이에요.");
  }
  r.version += 1;
  r.updated_at = now();
  save(s);
  return { id: r.id };
}

export function demoSpaceAction(
  action: string,
  input: unknown,
  id?: string,
): { id?: string } {
  const data = object(input),
    s = state();
  let resultId = id;
  switch (action) {
    case "material_add": {
      requireRole("teacher");
      if (s.space.materials.length >= 50)
        throw Error("시연 자료는 50개까지 등록할 수 있어요.");
      const title = text(data, "title", 120),
        content = text(data, "content", 30000),
        section = text(data, "section", 100, true);
      resultId = nextId("material");
      s.space.materials.unshift({
        id: resultId,
        title,
        section,
        content,
        enabled: true,
      });
      break;
    }
    case "material_edit": {
      requireRole("teacher");
      const m = s.space.materials.find((x) => x.id === id);
      if (!m) throw Error("자료를 찾을 수 없어요.");
      if (data.content !== undefined) m.content = text(data, "content", 30000);
      if (data.enabled !== undefined) {
        if (typeof data.enabled !== "boolean")
          throw Error("자료 사용 설정을 확인해 주세요.");
        m.enabled = data.enabled;
      }
      break;
    }
    case "feedback_send": {
      requireRole("teacher");
      const studentId = text(data, "student_id", 80),
        body = text(data, "body", 1500);
      if (!demoStudents.some((x) => x.id === studentId))
        throw Error("학생을 확인해 주세요.");
      if (
        id &&
        !s.records.some((r) => r.id === id && r.student_id === studentId)
      )
        throw Error("학생과 탐구 기록이 일치하지 않아요.");
      resultId = nextId("feedback");
      s.space.feedback.unshift({
        id: resultId,
        student_id: studentId,
        record_id: id || null,
        body,
        read_at: null,
        created_at: now(),
      });
      break;
    }
    case "feedback_read": {
      requireRole("student");
      const f = s.space.feedback.find(
        (x) => x.id === id && x.student_id === actor.id,
      );
      if (!f) throw Error("내 피드백을 찾을 수 없어요.");
      f.read_at ||= now();
      break;
    }
    case "chat_send": {
      requireRole("student");
      const room = text(data, "room", 20),
        question = text(data, "question", 500);
      if (!["course", "external"].includes(room))
        throw Error("질문할 공간을 선택해 주세요.");
      resultId = nextId("chat");
      // Deliberately a source-reading aid, not an imitation of a generated answer.
      const words = question.split(/\s+/).filter((w) => w.length > 1);
      const enabled = s.space.materials.filter((m) => m.enabled);
      const ranked = enabled
        .map((m) => ({
          m,
          score: words.reduce(
            (sum, w) =>
              sum + (m.content.includes(w) || m.title.includes(w) ? 1 : 0),
            0,
          ),
        }))
        .sort((a, b) => b.score - a.score);
      const match = ranked[0]?.score ? ranked[0].m : undefined;
      const quote = match?.content.slice(0, 240) || "";
      const source =
        room === "course" && match
          ? [{ title: match.title, section: match.section, quote }]
          : [];
      const answer =
        room === "external"
          ? "【준비된 예시 안내 · 실시간 검색·AI 아님】 이 시연에서는 새 외부 검색을 실행하지 않아요. 이미 준비된 PhET·NASA 자료의 예시 질문을 살펴보거나, 선생님께 더 확인할 질문을 남겨 주세요."
          : match
            ? `【자료 읽기 시연 · 실시간 AI 아님】 질문과 단어가 겹치는 등록 자료의 일부를 보여 드려요. 질문의 답이라고 자동 판단하지 않으니, 이 문장이 어떤 조건을 설명하는지 확인해 보세요.\n\n${quote}`
            : "【준비된 예시 안내 · 실시간 AI 아님】 새 질문의 답변을 생성하지 않았어요. 수업 자료에 있는 핵심 단어로 다시 찾아보거나, 선생님께 질문의 조건을 확인해 주세요. 준비된 예시 질문에는 답변과 근거 문장이 함께 들어 있어요.";
      s.space.chats.push({
        id: resultId,
        student_id: actor.id,
        room,
        question,
        answer,
        status: "sample",
        created_at: now(),
        sources: source,
      });
      break;
    }
    case "topic_add": {
      const title = text(data, "title", 200),
        unit = text(data, "unit", 80);
      resultId = nextId("topic");
      s.space.topics.unshift({ id: resultId, title, unit, created_at: now() });
      break;
    }
    case "post_add": {
      const body = text(data, "body", 1500),
        parentId = text(data, "parent_id", 100, true) || null;
      if (!s.space.topics.some((t) => t.id === id))
        throw Error("토론 주제를 찾을 수 없어요.");
      if (
        parentId &&
        !s.space.posts.some(
          (p) => p.id === parentId && p.topic_id === id && !p.parent_id,
        )
      )
        throw Error("답글을 달 생각을 다시 선택해 주세요.");
      resultId = nextId("post");
      s.space.posts.push({
        id: resultId,
        topic_id: id!,
        parent_id: parentId,
        author:
          actor.role === "teacher"
            ? "과학 선생님"
            : demoStudents.find((x) => x.id === actor.id)!.alias,
        author_id: actor.id,
        mine: true,
        is_teacher: actor.role === "teacher",
        body,
        likes: 0,
        liked: false,
        liked_by: [],
        created_at: now(),
      });
      break;
    }
    case "like_toggle": {
      const p = s.space.posts.find((x) => x.id === id);
      if (!p) throw Error("공감할 생각을 찾을 수 없어요.");
      p.liked_by = p.liked_by.includes(actor.id)
        ? p.liked_by.filter((x) => x !== actor.id)
        : [...p.liked_by, actor.id];
      break;
    }
    default:
      throw Error("지원하지 않는 시연 활동이에요.");
  }
  save(s);
  return { id: resultId };
}
