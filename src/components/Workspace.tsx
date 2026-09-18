"use client";
import { useCallback, useEffect, useState } from "react";
import { FlaskConical, LogOut } from "lucide-react";
import {
  lessons,
  items,
  hypotheses,
  experiments,
  RecordRow,
  Hypothesis,
  states,
} from "@/lib/content";
import { Student, Teacher } from "./Lab";
import {
  Space,
  emptySpace,
  Action,
  Intro,
  Empty,
  Materials,
  Chats,
  Discussion,
  Analytics,
  FeedbackForm,
  FeedbackInbox,
} from "./ClassroomPanels";
type Member = {
  user_id: string;
  alias: string;
  role: "student" | "teacher";
  class_id: string;
};
async function request(
  endpoint: string,
  action: string,
  data: unknown,
  id: string | null = null,
  version: number | null = null,
) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      data,
      id,
      version,
      request: crypto.randomUUID(),
    }),
  });
  const result = await res.json();
  if (!res.ok) throw Error(result.error);
  return result;
}
export default function Workspace({ configured }: { configured: boolean }) {
  const [member, setMember] = useState<Member | null>(null),
    [records, setRecords] = useState<RecordRow[]>([]),
    [space, setSpace] = useState<Space>(emptySpace),
    [lessonId, setLesson] = useState("D01"),
    [page, setPage] = useState("review"),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState("all"),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const refresh = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/lab", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw Error(data.error);
      setMember(data.member);
      setRecords(data.records ?? []);
      if (data.member) {
        const sr = await fetch("/api/space", { cache: "no-store" });
        const sd = await sr.json();
        if (!sr.ok) throw Error(sd.error);
        setSpace({ ...emptySpace, ...sd });
      } else setSpace(emptySpace);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [configured]);
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function labAct(action: string, data: unknown, r?: RecordRow) {
    setBusy(true);
    setError("");
    setToast("");
    try {
      const result = await request(
        "/api/lab",
        action,
        data,
        r?.id ?? null,
        r?.version ?? null,
      );
      await refresh();
      if (result.id) setSelected(result.id);
      if (action === "submit" || action === "reason") setPage("next");
      if (action === "logout") {
        setPage("review");
        setSelected("");
      }
      if (action === "login") setPage("review");
      if (!["login", "logout"].includes(action))
        setToast("생각을 저장하고 전달했어요.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const spaceAct: Action = async (action, data, id) => {
    setBusy(true);
    setError("");
    setToast("");
    try {
      await request("/api/space", action, data, id ?? null);
      await refresh();
      setToast(
        action === "chat_send"
          ? "질문을 보냈어요. 답변이 도착하면 여기에 표시돼요."
          : "저장했어요.",
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const teacher = member?.role === "teacher",
    lesson = lessons.find((l) => l.id === lessonId)!;
  const rows = records.filter((r) => r.item_id === lessonId);
  const reviewRows = rows.filter(
    (r) =>
      filter === "all" ||
      (filter === "pending" && r.state === "awaiting_review") ||
      (filter === "hold" && r.state === "needs_more_reason") ||
      (filter === "confirmed" && !!r.experiment_id),
  );
  const row = reviewRows.find((r) => r.id === selected) || reviewRows[0];
  const studentRow = rows.find((r) => r.id === selected) || rows[0];
  const unread = space.feedback.filter((f) => !f.read_at).length;
  const currentPage = page === "review" && !teacher ? "record" : page;
  const nav = teacher
    ? [
        ["analytics", "학습 현황"],
        ["review", "우리 반 생각"],
        ["materials", "수업 자료실"],
        ["history", "질문 기록"],
        ["discussion", "함께 생각하기"],
      ]
    : [
        ["feedback", `선생님 피드백${unread ? " · " + unread : ""}`],
        ["record", "내 생각 기록"],
        ["next", "다음 활동"],
        ["chat", "궁금해요 채팅"],
        ["discussion", "함께 생각하기"],
      ];
  return (
    <div id="science-sos">
      <header className="ss-top">
        <a className="ss-brand" href="/">
          <span className="ss-logo">
            <FlaskConical size={23} />
          </span>
          <div>
            과학SOS<div className="ss-subbrand">THINK. ASK. DISCOVER.</div>
          </div>
        </a>
        <div className="ss-role">
          <span aria-current="page">
            {member
              ? teacher
                ? "교사 화면"
                : "학생 화면"
              : "우리 반 과학 수업"}
          </span>
        </div>
        <div className="ss-account">
          {member && (
            <>
              <span>{member.alias}</span>
              <button
                className="ss-icon-button"
                aria-label="로그아웃"
                disabled={busy}
                onClick={() => labAct("logout", {})}
              >
                <LogOut size={16} />
              </button>
            </>
          )}
        </div>
      </header>
      <div className="ss-shell">
        <aside className="ss-sidebar">
          <div className="ss-smalltitle">WORKSPACE</div>
          <div className="ss-navitem">
            ◫ &nbsp; {teacher ? "우리 반 생각" : "나의 과학 수업"}
          </div>
          <div className="ss-sidecourse">
            <strong>우리 반 과학</strong>
            <p>{member ? "담당 과학 교실" : "반례 실험실"}</p>
            <p>{lesson.tag}</p>
          </div>
          <div className="ss-sidehint">
            같은 답 안에도
            <br />
            서로 다른 생각이
            <br />
            담겨 있어요.
          </div>
        </aside>
        <main className="ss-main">
          {error && (
            <div className="ss-alert" role="alert">
              {error}
              <button onClick={() => setError("")}>닫기</button>
            </div>
          )}
          {toast && (
            <div className="ss-toast" role="status">
              {toast}
            </div>
          )}
          {!member ? (
            <div className="ss-login-wrap">
              <Intro
                tag="WELCOME TO SCIENCE SOS"
                title="네 생각이 궁금해."
                description="예측하고, 질문하고, 선생님과 다음 발견을 시작하세요."
              />
              <section className="ss-panel">
                <h2>우리 반 수업에 들어가기</h2>
                <p className="ss-note">
                  배정받은 학생 또는 교사 계정으로 로그인하세요.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    labAct("login", {
                      email: data.get("email"),
                      password: data.get("password"),
                    });
                  }}
                >
                  <label className="ss-label">
                    이메일
                    <input
                      name="email"
                      type="email"
                      required
                      autoComplete="username"
                    />
                  </label>
                  <label className="ss-label">
                    비밀번호
                    <input
                      name="password"
                      type="password"
                      required
                      autoComplete="current-password"
                    />
                  </label>
                  <button
                    className="ss-button primary ss-wide"
                    disabled={busy || loading || !configured}
                  >
                    수업에 들어가기 →
                  </button>
                </form>
                {!configured && (
                  <p className="ss-error">
                    수업 데이터베이스 연결이 필요합니다.
                  </p>
                )}
              </section>
            </div>
          ) : (
            <>
              <div className="ss-class-switch">
                <div>
                  <span className="ss-eyebrow">진행 중인 수업</span>
                  <strong>
                    우리 반 과학{teacher ? ` · ${space.members.length}명` : ""}
                  </strong>
                </div>
                <label className="ss-label">
                  살펴볼 수업 질문
                  <select
                    value={lessonId}
                    onChange={(e) => {
                      setLesson(e.target.value);
                      setSelected("");
                      setFilter("all");
                      setToast("");
                    }}
                  >
                    {lessons.map((l, i) => (
                      <option key={l.id} value={l.id}>
                        {String(i + 1).padStart(2, "0")} · {l.tag} — {l.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <nav
                className="ss-work-tabs"
                aria-label={teacher ? "교사 작업" : "학생 작업"}
              >
                {nav.map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={currentPage === id}
                    onClick={() => {
                      setPage(id);
                      setToast("");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              {currentPage === "materials" && teacher ? (
                <Materials
                  materials={space.materials}
                  unit={lesson.tag}
                  act={spaceAct}
                  busy={busy}
                />
              ) : currentPage === "analytics" && teacher ? (
                <Analytics
                  key={lessonId}
                  records={rows}
                  title={lesson.title}
                  answer={space.answers[lessonId]}
                  totalMembers={space.members.length}
                />
              ) : currentPage === "history" || currentPage === "chat" ? (
                <Chats
                  space={space}
                  teacher={teacher}
                  act={spaceAct}
                  busy={busy}
                />
              ) : currentPage === "discussion" ? (
                <Discussion
                  space={space}
                  act={spaceAct}
                  busy={busy}
                  unit={lesson.tag}
                />
              ) : currentPage === "feedback" ? (
                <FeedbackInbox
                  entries={space.feedback}
                  act={spaceAct}
                  busy={busy}
                />
              ) : teacher ? (
                <>
                  <Intro
                    tag="CLASSROOM / 우리 반"
                    title="우리 반은 어떻게 생각했을까요?"
                    description="답보다 이유를 먼저 읽고, 다음 수업을 열어 주세요."
                  />
                  <div className="ss-lesson">
                    <div>
                      <h3>{lesson.title}</h3>
                      <p>{lesson.tag} · 같은 질문의 응답을 모아 봅니다.</p>
                    </div>
                    <span className="ss-pill teal">
                      응답 {new Set(rows.map((r) => r.student_id)).size}명
                    </span>
                  </div>
                  <div className="ss-filter">
                    {[
                      ["all", `전체 ${rows.length}`],
                      [
                        "pending",
                        `검토할 생각 ${rows.filter((r) => r.state === "awaiting_review").length}`,
                      ],
                      ["confirmed", "확인 완료"],
                      ["hold", "추가 질문"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        aria-pressed={filter === id}
                        onClick={() => setFilter(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="ss-reviewgrid">
                    <div className="ss-list">
                      {!reviewRows.length ? (
                        <Empty>이 상태의 학생 기록이 없어요.</Empty>
                      ) : (
                        reviewRows.map((r) => (
                          <button
                            className="ss-person"
                            key={r.id}
                            aria-pressed={r.id === row?.id}
                            onClick={() => setSelected(r.id)}
                          >
                            <div className="ss-person-top">
                              <strong>
                                <span className="ss-avatar">
                                  {r.student_alias.slice(-2)}
                                </span>
                                {r.student_alias}
                              </strong>
                              <span className="ss-pill">{states[r.state]}</span>
                            </div>
                            <blockquote>“{r.reason}”</blockquote>
                            <div className="ss-person-foot">
                              <span>{hypotheses[r.hypothesis]}</span>
                              <span>
                                {r.analysis_mode === "live"
                                  ? "AI 제안"
                                  : r.experiment_id
                                    ? "교사 검토"
                                    : "분석 대기"}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                    {row ? (
                      <Review
                        key={row.id + row.version + row.analysis_mode}
                        r={row}
                        labAct={labAct}
                        spaceAct={spaceAct}
                        busy={busy}
                      />
                    ) : (
                      <section className="ss-panel">
                        <Empty>
                          학생이 이유를 제출하면 원문과 검토 화면이 열립니다.
                        </Empty>
                      </section>
                    )}
                  </div>
                </>
              ) : currentPage === "next" ? (
                <div className="ss-student">
                  <Intro
                    tag="나의 과학 수업 / 다음 활동"
                    title="내 생각, 한 걸음 더."
                    description="선생님이 선택한 활동으로 조건을 비교하고 설명을 다시 써보세요."
                  />
                  {studentRow ? (
                    <section className="ss-panel ss-existing">
                      <Student
                        key={studentRow.id + studentRow.version}
                        r={studentRow}
                        act={async (a, d, r) => {
                          await labAct(a, d, r);
                        }}
                        busy={busy}
                      />
                    </section>
                  ) : (
                    <Empty>
                      아직 이 질문에 남긴 생각이 없어요. ‘내 생각 기록’에서
                      예측을 보내 주세요.
                    </Empty>
                  )}
                  {rows.length > 1 && (
                    <label className="ss-label ss-spaced">
                      이전 탐구 기록
                      <select
                        value={studentRow?.id || ""}
                        onChange={(e) => setSelected(e.target.value)}
                      >
                        {rows.map((r) => (
                          <option key={r.id} value={r.id}>
                            {new Date(r.created_at).toLocaleString("ko-KR")} ·{" "}
                            {states[r.state]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              ) : (
                <div className="ss-student">
                  <div className="ss-chat-entry">
                    <div>
                      <strong>궁금한 건 바로 물어봐요.</strong>
                      <p>
                        수업 자료로 이해하고, 더 궁금하면 바깥으로 탐색해요.
                      </p>
                    </div>
                    <button
                      className="ss-button"
                      onClick={() => setPage("chat")}
                    >
                      궁금해요 채팅 →
                    </button>
                  </div>
                  <StudentForm
                    key={lessonId}
                    lesson={lesson}
                    busy={busy}
                    submit={(data) => labAct("submit", data)}
                  />
                </div>
              )}
            </>
          )}
        </main>
      </div>
      <footer className="ss-footer">
        <span>과학SOS · 반례 실험실</span>
        <span>이유를 읽고, 질문을 잇고, 생각의 변화를 기록해요.</span>
      </footer>
    </div>
  );
}
function Thinking() {
  const [choice, setChoice] = useState(0);
  const prompts = [
    [
      "왜?",
      "왜 그렇게 될 거라고 생각했나요?",
      "나는 ___라고 생각해요. 왜냐하면 ___이기 때문이에요.",
    ],
    [
      "어떻게?",
      "내 생각을 어떻게 확인할 수 있을까요?",
      "___을 바꾸고 ___을 관찰해 볼 거예요.",
    ],
    [
      "무엇을 보고?",
      "어떤 조건에 주목했나요?",
      "나는 ___을 보고 ___라고 생각했어요.",
    ],
    [
      "만약?",
      "조건 하나가 달라진다면 어떻게 될까요?",
      "만약 ___이 달라지면 ___할 것 같아요.",
    ],
  ];
  return (
    <div className="ss-thinking">
      <div className="ss-thinking-title">어디서부터 써야 할지 막막하다면</div>
      <p className="ss-thinking-sub">
        질문 하나를 골라 보세요. 모두 답하지 않아도 괜찮아요.
      </p>
      <div className="ss-thinking-options">
        {prompts.map((p, i) => (
          <button
            key={p[0]}
            type="button"
            aria-pressed={choice === i}
            onClick={() => setChoice(i)}
          >
            {p[0]}
          </button>
        ))}
      </div>
      <div aria-live="polite">
        <p className="ss-thinking-question">{prompts[choice][1]}</p>
        <p className="ss-thinking-starter">
          이렇게 시작해도 좋아요
          <br />“{prompts[choice][2]}”
        </p>
      </div>
    </div>
  );
}
function StudentForm({
  lesson,
  busy,
  submit,
}: {
  lesson: (typeof lessons)[number];
  busy: boolean;
  submit: (d: Record<string, unknown>) => Promise<boolean>;
}) {
  const [reason, setReason] = useState(""),
    [difficult, setDifficult] = useState(false);
  return (
    <>
      <Intro
        tag={"나의 과학 수업 / " + lesson.tag}
        title="네 생각이 궁금해."
        description="아직 모르겠어도 괜찮아요. 지금 떠오른 생각을 남겨 주세요."
      />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          await submit({
            item: lesson.id,
            prediction: f.get("prediction"),
            reason:
              reason.trim() || (difficult ? "말로 설명하기 어려워요." : ""),
            stuck: f.get("stuck"),
            note: f.get("note"),
            difficult,
          });
        }}
      >
        <section className="ss-question">
          <div className="ss-step">01 &nbsp; 결과를 예상해 보기</div>
          <h2>{lesson.title}</h2>
          <div className="ss-lesson-context">
            <span className="ss-pill teal">{lesson.tag}</span>
            <p>{lesson.description}</p>
          </div>
          <div className="ss-options">
            {lesson.choices.map((c) => (
              <label className="ss-option" key={c}>
                <input type="radio" name="prediction" value={c} required />
                {c}
              </label>
            ))}
          </div>
        </section>
        <section className="ss-question">
          <span className="ss-step">02 &nbsp; 내 생각 들여다보기</span>
          <label className="ss-label" htmlFor="student-reason">
            <h2>왜 그렇게 생각했나요?</h2>
          </label>
          <textarea
            id="student-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required={!difficult}
            maxLength={300}
            placeholder="네 생각을 자유롭게 적어 주세요."
          />
          <span className="ss-note">{[...reason].length} / 300</span>
          <Thinking />
          <label className="ss-check">
            <input
              type="checkbox"
              checked={difficult}
              onChange={(e) => setDifficult(e.target.checked)}
            />
            말로 설명하기 어려워요.
          </label>
          <div className="ss-formrow ss-spaced">
            <label className="ss-label">
              어떤 부분이 어려웠나요? · 선택
              <select name="stuck">
                {[
                  "선택하지 않음",
                  "결과 예상",
                  "이유 설명",
                  "문제 이해",
                  "어려움 없음",
                  "잘 모르겠음",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="ss-label">
              더 확인하고 싶은 점 · 선택
              <input
                name="note"
                maxLength={300}
                placeholder="궁금한 점이 있나요?"
              />
            </label>
          </div>
          <button
            className="ss-button primary ss-wide"
            disabled={busy || (!reason.trim() && !difficult)}
          >
            내 생각 보내기 →
          </button>
        </section>
      </form>
    </>
  );
}
function Review({
  r,
  labAct,
  spaceAct,
  busy,
}: {
  r: RecordRow;
  labAct: (a: string, d: unknown, r?: RecordRow) => Promise<boolean>;
  spaceAct: Action;
  busy: boolean;
}) {
  const [decision, setDecision] = useState("confirm"),
    [hypothesis, setHypothesis] = useState<Hypothesis>(r.hypothesis),
    [activity, setActivity] = useState(
      r.experiment_id ||
        (["D01", "D02", "D03"].includes(r.item_id)
          ? experiments.find((e) => e.kind === r.hypothesis)?.id ||
            "wood80_iron20"
          : "guided"),
    ),
    [question, setQuestion] = useState(
      r.teacher_question || "그렇게 생각한 이유를 조금 더 설명해 줄래요?",
    ),
    [note, setNote] = useState("");
  const canReview = [
    "awaiting_review",
    "needs_more_reason",
    "experiment_assigned",
  ].includes(r.state);
  return (
    <section className="ss-panel">
      {canReview && (
        <div className="ss-panelhead">
          <h2>{r.student_alias}의 생각</h2>
          <span className="ss-pill">{states[r.state]}</span>
        </div>
      )}
      {canReview ? (
        <>
          <span className="ss-label">학생이 예측한 결과</span>
          <div className="ss-answer">{r.prediction}</div>
          <span className="ss-label">왜 그렇게 생각했나요?</span>
          <div className="ss-quote">{r.reason}</div>
          <div className="ss-meta">
            <span>막힌 부분 · {r.initial_stuck || "선택하지 않음"}</span>
            {r.difficult && <span>설명하기 어려움</span>}
          </div>
          {r.initial_note && (
            <div className="ss-field">
              <span className="ss-label">스스로 더 확인하고 싶은 점</span>
              <p>{r.initial_note}</p>
            </div>
          )}
          <div className="ss-ai">
            <span className="ss-pill teal">
              {r.analysis_mode === "live"
                ? "AI 제안 · 실제 분석"
                : r.experiment_id
                  ? "교사가 검토한 가설"
                  : r.analysis_mode === "error"
                    ? "AI 분석 불가"
                    : "AI 분석 대기"}
            </span>
            <strong>{hypotheses[r.hypothesis]}</strong>
            <p>
              {r.analysis_note || "학생의 원문을 읽고 직접 검토할 수도 있어요."}
            </p>
          </div>
          <h3>어떻게 이어갈까요?</h3>
          <div className="ss-decision">
            {[
              ["confirm", "확인"],
              ["edit", "수정"],
              ["hold", "보류"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={decision === id}
                onClick={() => setDecision(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              labAct(
                "review",
                {
                  decision,
                  hypothesis,
                  experiment: activity,
                  question,
                  review_note: note,
                },
                r,
              );
            }}
          >
            {decision === "hold" ? (
              <label className="ss-field ss-label">
                학생에게 보낼 추가 질문
                <textarea
                  required
                  maxLength={500}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              </label>
            ) : (
              <>
                <label className="ss-field ss-label">
                  확인할 설명 유형
                  <select
                    value={hypothesis}
                    onChange={(e) =>
                      setHypothesis(e.target.value as Hypothesis)
                    }
                    required
                  >
                    <option value="hold" disabled>
                      원문을 읽고 가설을 선택하세요
                    </option>
                    {Object.entries(hypotheses)
                      .filter(([k]) => k !== "hold")
                      .map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                  </select>
                </label>
                {decision === "edit" && (
                  <label className="ss-field ss-label">
                    수정 이유
                    <input
                      required
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={300}
                      placeholder="원문에서 확인한 근거를 남겨 주세요."
                    />
                  </label>
                )}
                <label className="ss-field ss-label">
                  교사가 선택하는 다음 활동
                  <select
                    value={activity}
                    onChange={(e) => setActivity(e.target.value)}
                  >
                    {experiments
                      .filter(
                        (e) =>
                          ["D01", "D02", "D03"].includes(r.item_id) ||
                          e.id === "guided",
                      )
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.title}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
            <button
              className="ss-button primary ss-wide"
              disabled={busy || (decision !== "hold" && hypothesis === "hold")}
            >
              {decision === "hold"
                ? "추가 질문 전달하기"
                : decision === "edit"
                  ? "수정하고 전달하기"
                  : "확인하고 전달하기"}{" "}
              →
            </button>
            <p className="ss-note">
              {decision === "hold"
                ? "활동을 배정하지 않고, 학생에게 이유를 다시 물어요."
                : "선택한 활동이 학생의 ‘다음 활동’에 표시됩니다."}
            </p>
          </form>
        </>
      ) : (
        <div className="ss-existing">
          <Teacher
            r={r}
            busy={busy}
            act={async (a, d, row) => {
              await labAct(a, d, row);
            }}
          />
        </div>
      )}
      <FeedbackForm
        studentId={r.student_id}
        recordId={r.id}
        act={spaceAct}
        busy={busy}
      />
    </section>
  );
}
