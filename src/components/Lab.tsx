"use client";
import { useEffect, useState, useCallback } from "react";
import {
  FlaskConical,
  ArrowUpRight,
  ArrowRight,
  Check,
  BookOpen,
  Layers,
  LogOut,
  ChevronRight,
  Clock3,
  Lightbulb,
  ShieldCheck,
  RefreshCw,
  Search,
  Atom,
  Activity,
} from "lucide-react";
import {
  items,
  experiments,
  hypotheses,
  states,
  RecordRow,
  Hypothesis,
} from "@/lib/content";
type Member = { alias: string; role: "student" | "teacher" };
type Experiment = {
  left: string;
  right: string;
  leftFloats: boolean;
  rightFloats: boolean;
  detail: string;
  result: string;
  id: string;
};
async function api(
  action: string,
  data: unknown,
  id: string | null = null,
  version: number | null = null,
) {
  const res = await fetch("/api/lab", {
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
  const v = await res.json();
  if (!res.ok) throw Error(v.error);
  return v;
}
export default function Lab({ configured }: { configured: boolean }) {
  const [member, setMember] = useState<Member | null>(null),
    [records, setRecords] = useState<RecordRow[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [itemId, setItemId] = useState("D01"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [filter, setFilter] = useState("all"),
    [view, setView] = useState("lab");
  const refresh = useCallback(async () => {
    if (!configured) {
      setLoaded(true);
      return;
    }
    try {
      const res = await fetch("/api/lab", { cache: "no-store" });
      const v = await res.json();
      if (!res.ok) throw Error(v.error);
      setMember(v.member);
      setRecords(v.records ?? []);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
      setLoaded(true);
    }
  }, [configured]);
  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (!document.hidden) refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [refresh]);
  async function act(action: string, data: unknown, r?: RecordRow) {
    setBusy(true);
    setError("");
    try {
      const v = await api(action, data, r?.id ?? null, r?.version ?? null);
      await refresh();
      if (v.id) setSelected(v.id);
      if (action === "logout") setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const row = records.find((r) => r.id === selected);
  const current = items.find((i) => i.id === itemId)!;
  const teacher = member?.role === "teacher";
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <FlaskConical size={23} />
          </span>
          <div>
            과학SOS<small>반례실험실</small>
          </div>
        </a>
        <div className="workspace">
          <span className="avatar">S</span>
          <div>
            우리의 과학 교실<small>밀도 · 중학교 과학</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          <button
            className={view === "lab" ? "active" : ""}
            onClick={() => setView("lab")}
          >
            <Layers size={18} />
            {teacher ? "우리 반 탐구 기록" : "나의 실험실"}
            <span className="nav-dot" />
          </button>
          <button
            className={view === "journal" ? "active" : ""}
            onClick={() => setView("journal")}
          >
            <BookOpen size={18} />
            생각의 변화
            <span className="count">
              {records.filter((r) => r.revised_text).length}
            </span>
          </button>
        </nav>
        <div className="side-note">
          <Atom size={28} />
          <b>틀려도 괜찮아요.</b>
          <p>
            새로운 발견은
            <br />
            질문에서 시작되니까요.
          </p>
          <div className="mini-orbit" />
        </div>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          교사와 함께하는 탐구<small>AI IMPACT · SEOUL 2026</small>
        </div>
      </aside>
      <div className="main-wrap">
        <header>
          <div className="breadcrumb">
            워크스페이스 <ChevronRight size={13} />
            <b>{teacher ? "선생님 공간" : "반례실험실"}</b>
          </div>
          <div className="header-right">
            <span className="pill soft">
              <span className="status-dot" />
              밀도 탐구
            </span>
            {member ? (
              <>
                <span className="avatar small">{member.alias.slice(0, 1)}</span>
                <span>{member.alias}</span>
                <button
                  className="icon-btn"
                  aria-label="로그아웃"
                  onClick={() => act("logout", {})}
                >
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <span className="muted">SCIENCE SOS</span>
            )}
          </div>
        </header>
        <main>
          <div className="page-top">
            <div>
              <div className="eyebrow">THINK. OBSERVE. RETHINK.</div>
              <h1>
                {teacher
                  ? "같은 오답, 다른 생각."
                  : "생각이 바뀌는 순간을 만나요."}
              </h1>
              <p>
                {teacher
                  ? "학생의 이유를 읽고, 다음 발견으로 이어지는 실험을 골라주세요."
                  : "예측하고, 직접 관찰하고, 나만의 설명을 다시 써보세요."}
              </p>
            </div>
            <span className="chapter">
              <FlaskConical size={18} />
              물질의 특성 <span>01</span>
            </span>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError("")}>닫기</button>
            </div>
          )}
          {!member ? (
            <div className="welcome-grid">
              <div className="welcome-art">
                <div className="pill">작은 실험, 새로운 생각</div>
                <h2>
                  왜 그렇게
                  <br />
                  생각했나요<span>?</span>
                </h2>
                <p>
                  정답보다 궁금한 건, 너의 이유.
                  <br />한 번의 관찰로 생각의 다음 문을 열어요.
                </p>
                <div className="hero-tanks">
                  <Tank name="나무" color="wood" />
                  <Tank name="철" color="iron" />
                </div>
                <div className="art-caption">
                  <span>01 예측</span>
                  <ArrowRight size={16} />
                  <span>02 관찰</span>
                  <ArrowRight size={16} />
                  <span>03 다시 설명</span>
                </div>
              </div>
              <section className="card login">
                <span className="eyebrow">WELCOME TO THE LAB</span>
                <h2>실험실에 들어가기</h2>
                <p>배정받은 학생 또는 교사 계정으로 로그인하세요.</p>
                {!configured ? (
                  <div className="notice">
                    데이터베이스 연결 준비 중입니다. 연결 후 실제 기록을 저장할
                    수 있어요.
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      act("login", {
                        email: f.get("email"),
                        password: f.get("password"),
                      });
                    }}
                  >
                    <label>
                      이메일
                      <input
                        name="email"
                        type="email"
                        autoComplete="username"
                        required
                        placeholder="배정받은 이메일"
                      />
                    </label>
                    <label>
                      비밀번호
                      <input
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        placeholder="비밀번호를 입력하세요"
                      />
                    </label>
                    <button className="primary full" disabled={busy || !loaded}>
                      {busy ? "연결 중…" : "실험실 입장"}
                      <ArrowRight size={17} />
                    </button>
                  </form>
                )}
                <div className="login-foot">
                  <ShieldCheck size={18} />
                  <span>
                    학생의 기록은 담당 선생님만 볼 수 있어요.
                    <br />
                    AI의 제안은 선생님이 확인해요.
                  </span>
                </div>
              </section>
            </div>
          ) : (
            <>
              <div className="stats">
                <Stat
                  label={teacher ? "탐구 기록" : "나의 탐구"}
                  value={records.length}
                  suffix="개"
                />
                <Stat
                  label="교사 확인 대기"
                  value={
                    records.filter((r) => r.state === "awaiting_review").length
                  }
                  suffix="개"
                />
                <Stat
                  label="설명 다시 쓰기"
                  value={records.filter((r) => r.revised_text).length}
                  suffix="개"
                />
                <Stat
                  label="새 사례까지 완료"
                  value={records.filter((r) => r.state === "completed").length}
                  suffix="개"
                />
              </div>
              {view === "journal" ? (
                <section className="card">
                  <div className="section-title">
                    <h2>내 설명은 어떻게 달라졌을까?</h2>
                    <span className="pill">사고 기록</span>
                  </div>
                  {records.filter((r) => r.revised_text).length === 0 ? (
                    <Empty text="아직 수정한 설명이 없어요. 실험을 마치면 이곳에 기록이 쌓여요." />
                  ) : (
                    records
                      .filter((r) => r.revised_text)
                      .map((r) => (
                        <div className="journal" key={r.id}>
                          <b>
                            {r.student_alias} ·{" "}
                            {items.find((i) => i.id === r.item_id)?.title}
                          </b>
                          <Comparison
                            before={r.reason}
                            after={r.revised_text!}
                          />
                          <p className="muted">
                            나의 발견 · {r.self_note || "메모 없음"}
                          </p>
                        </div>
                      ))
                  )}
                </section>
              ) : teacher ? (
                <div className="teacher-grid">
                  <section className="card record-list">
                    <div className="section-title">
                      <h2>우리 반 생각 모음</h2>
                      <button
                        className="icon-btn"
                        aria-label="기록 새로고침"
                        onClick={refresh}
                      >
                        <RefreshCw size={16} />
                      </button>
                    </div>
                    <label>
                      같은 이유로 묶어 보기
                      <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">전체 생각</option>
                        {Object.entries(hypotheses).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v} ·{" "}
                            {
                              records.filter(
                                (r) =>
                                  r.analysis_mode === "live" &&
                                  r.hypothesis === k,
                              ).length
                            }
                            개
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="filters">
                      {[
                        ["all", "전체"],
                        ["awaiting_review", "확인 대기"],
                        ["needs_more_reason", "보류"],
                        ["reassessed", "재확인"],
                      ].map(([k, v]) => (
                        <button
                          key={k}
                          className={filter === k ? "selected" : ""}
                          onClick={() => setFilter(k)}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    {records
                      .filter(
                        (r) =>
                          filter === "all" ||
                          r.state === filter ||
                          (r.analysis_mode === "live" &&
                            r.hypothesis === filter),
                      )
                      .map((r) => (
                        <button
                          className={
                            "record-item " +
                            (selected === r.id ? "selected" : "")
                          }
                          key={r.id}
                          onClick={() => setSelected(r.id)}
                        >
                          <div>
                            <span className="avatar small">
                              {r.student_alias.slice(0, 1)}
                            </span>
                            <b>{r.student_alias}</b>
                            <span className="tiny-pill">{states[r.state]}</span>
                          </div>
                          <p>{r.reason}</p>
                          <small>
                            {hypotheses[r.hypothesis] || "분석 대기"}
                            <ChevronRight size={14} />
                          </small>
                        </button>
                      ))}
                    {records.length === 0 && (
                      <Empty text="학생이 이유를 제출하면 여기에 표시돼요." />
                    )}
                  </section>
                  <section className="card">
                    {row ? (
                      <Teacher
                        key={row.id + row.version + row.analysis_mode}
                        r={row}
                        act={act}
                        busy={busy}
                      />
                    ) : (
                      <Empty text="왼쪽에서 학생의 탐구 기록을 선택해 주세요." />
                    )}
                  </section>
                </div>
              ) : (
                <div className="student-grid">
                  <section className="card main-card">
                    {row ? (
                      <Student
                        key={row.id + row.version}
                        r={row}
                        act={act}
                        busy={busy}
                      />
                    ) : (
                      <>
                        <div className="section-title">
                          <span className="pill peach">오늘의 탐구 질문</span>
                          <span className="muted">약 10분</span>
                        </div>
                        <div className="item-tabs">
                          {items.slice(0, 3).map((i, n) => (
                            <button
                              key={i.id}
                              onClick={() => setItemId(i.id)}
                              className={itemId === i.id ? "selected" : ""}
                            >
                              실험 0{n + 1}
                            </button>
                          ))}
                        </div>
                        <h2 className="question">{current.title}</h2>
                        <p>{current.description}</p>
                        <div className="object-row">
                          {current.objects.map((o) => (
                            <div
                              className={"object-card " + o.color}
                              key={o.name}
                            >
                              <div className={"cube " + o.color} />
                              <b>{o.name}</b>
                              <strong>{o.mass}</strong>
                              <small>{o.detail}</small>
                            </div>
                          ))}
                        </div>
                        <Prediction
                          key={itemId}
                          choices={current.choices}
                          busy={busy}
                          onSubmit={(prediction, reason) =>
                            act("submit", { item: itemId, prediction, reason })
                          }
                        />
                      </>
                    )}
                  </section>
                  <aside className="right-rail">
                    <section className="card help-card">
                      <span className="icon-circle">
                        <Lightbulb size={20} />
                      </span>
                      <h3>
                        정답보다 중요한 건<br />
                        생각의 이유예요.
                      </h3>
                      <p>
                        지금 알고 있는 것으로 설명해 보세요. 관찰한 뒤 생각을
                        바꿔도 괜찮아요.
                      </p>
                      <div className="hint-line">
                        언제 <span>조건을 비교해요</span>
                      </div>
                      <div className="hint-line">
                        무엇을 봤나 <span>관찰을 기록해요</span>
                      </div>
                      <div className="hint-line">
                        둘 다 설명하려면 <span>생각을 연결해요</span>
                      </div>
                    </section>
                    <section className="card">
                      <div className="section-title">
                        <h3>나의 탐구 기록</h3>
                        <span className="count">{records.length}</span>
                      </div>
                      <button
                        className="text-btn"
                        onClick={() => setSelected(null)}
                      >
                        + 새로운 탐구 시작
                      </button>
                      {records.length === 0 ? (
                        <p className="muted small-text">
                          첫 번째 예측을 남겨보세요.
                        </p>
                      ) : (
                        records.map((r) => (
                          <button
                            className="history-item"
                            onClick={() => setSelected(r.id)}
                            key={r.id}
                          >
                            <span>
                              {items.find((i) => i.id === r.item_id)?.title}
                            </span>
                            <small>{states[r.state]}</small>
                          </button>
                        ))
                      )}
                    </section>
                  </aside>
                </div>
              )}
            </>
          )}
          <footer>
            <span>과학SOS · 반례실험실</span>
            <span>정답을 넘어, 생각의 변화로.</span>
            <span>AI FOR GOOD SEOUL</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Stat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix: string;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>
        {value}
        <small>{suffix}</small>
      </strong>
      <Activity size={20} />
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <Search size={30} />
      <p>{text}</p>
    </div>
  );
}
function Tank({
  name,
  color,
  down = false,
  active = false,
}: {
  name: string;
  color: string;
  down?: boolean;
  active?: boolean;
}) {
  return (
    <div className="tank-wrap">
      <div className="tank">
        <div className="water-line" />
        <div
          className={
            "tank-object " + color + (active ? (down ? " sink" : " float") : "")
          }
        />
        <span className="bubble b1" />
        <span className="bubble b2" />
      </div>
      <b>{name}</b>
    </div>
  );
}
function Prediction({
  choices,
  busy,
  onSubmit,
}: {
  choices: string[];
  busy: boolean;
  onSubmit: (p: string, r: string) => void;
}) {
  const [p, setP] = useState(""),
    [reason, setReason] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(p, reason);
      }}
    >
      <h3>
        <span className="step-number">1</span>어떻게 될 것 같나요?
      </h3>
      <div className="choices">
        {choices.map((c) => (
          <label className={"choice " + (p === c ? "selected" : "")} key={c}>
            <input
              type="radio"
              name="prediction"
              required
              value={c}
              checked={p === c}
              onChange={() => setP(c)}
            />
            {c}
          </label>
        ))}
      </div>
      <label className="reason-label">
        <span>
          <span className="step-number">2</span>왜 그렇게 생각했나요?
        </span>
        <textarea
          required
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="내가 생각한 이유를 한 문장으로 남겨주세요."
        />
        <small>{[...reason].length} / 300</small>
      </label>
      <button className="primary" disabled={busy || !p || !reason.trim()}>
        {busy ? "저장 중…" : "내 생각 보내기"}
        <ArrowRight size={17} />
      </button>
    </form>
  );
}
type Act = (a: string, d: unknown, r?: RecordRow) => Promise<void>;
function Student({ r, act, busy }: { r: RecordRow; act: Act; busy: boolean }) {
  const item = items.find((i) => i.id === r.item_id)!,
    [exp, setExp] = useState<Experiment | null>(null),
    [played, setPlayed] = useState(false),
    [text, setText] = useState(""),
    [note, setNote] = useState(""),
    [stuck, setStuck] = useState("none"),
    [expError, setExpError] = useState("");
  useEffect(() => {
    if (["experiment_assigned", "observed"].includes(r.state))
      fetch("/api/lab?experiment=" + r.id)
        .then(async (v) => {
          const d = await v.json();
          if (!v.ok) throw Error(d.error);
          setExp(d);
        })
        .catch((e) => setExpError(e.message));
  }, [r.id, r.state]);
  const step = ["awaiting_review", "needs_more_reason"].includes(r.state)
    ? 0
    : r.state === "experiment_assigned"
      ? 1
      : r.state === "observed"
        ? 2
        : 3;
  return (
    <>
      <div className="section-title">
        <span className="pill peach">{item.tag}</span>
        <span className="tiny-pill">{states[r.state]}</span>
      </div>
      <h2 className="question">{item.title}</h2>
      <div className="progress">
        {["내 생각", "관찰하기", "다시 설명", "새 사례"].map((s, n) => (
          <div className={n <= step ? "done" : ""} key={s}>
            <span>{n < step ? <Check size={12} /> : n + 1}</span>
            {s}
          </div>
        ))}
      </div>
      <div className="original">
        <small>나의 첫 생각</small>
        <b>{r.prediction}</b>
        <p>“{r.reason}”</p>
      </div>
      {r.state === "awaiting_review" && (
        <div className="waiting">
          <Clock3 size={30} />
          <h3>선생님이 다음 실험을 확인하고 있어요.</h3>
          <p>
            {r.analysis_mode === "pending"
              ? "AI가 제출한 이유를 살펴보고 있어요."
              : "내 생각에 맞는 실험을 선생님이 골라줄 거예요."}
          </p>
          <span className="pill soft">기록이 저장되었어요</span>
        </div>
      )}
      {r.state === "needs_more_reason" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act("reason", { reason: text }, r);
          }}
        >
          <div className="notice">
            어떤 조건을 보고 그렇게 생각했나요? 이유를 조금 더 설명해 주세요.
          </div>
          <label>
            이유 보완
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={300}
              required
            />
          </label>
          <button className="primary" disabled={busy || !text.trim()}>
            선생님께 다시 보내기
            <ArrowRight size={16} />
          </button>
        </form>
      )}
      {expError && <div className="error">{expError}</div>}
      {r.state === "experiment_assigned" && exp && (
        <div className="experiment">
          <div className="section-title">
            <h3>직접 관찰해 볼까요?</h3>
            <span className="pill soft">
              <ShieldCheck size={13} />
              교사 승인 완료
            </span>
          </div>
          <p>내 예측과 다른 점을 찾아보세요.</p>
          <div className="experiment-tanks">
            <Tank
              name={exp.left}
              color={exp.id === "change_liquid" ? "iron" : "wood"}
              active={played}
              down={!exp.leftFloats}
            />
            <Tank
              name={exp.right}
              color={exp.id === "split_wood" ? "wood" : "iron"}
              active={played}
              down={!exp.rightFloats}
            />
          </div>
          <p className="caption">{exp.detail} · 이상화한 가상 실험</p>
          {played && <div className="observation-result">{exp.result}</div>}
          <button className="secondary" onClick={() => setPlayed(!played)}>
            {played ? "처음으로" : "실험 시작"}
            <FlaskConical size={17} />
          </button>
          {played && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => act("observe", {}, r)}
            >
              관찰했어요
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      )}
      {r.state === "observed" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act("revise", { text, note, stuck }, r);
          }}
        >
          <div className="observation-result">
            <b>무엇을 봤나</b>
            <p>{r.observation}</p>
          </div>
          <label>
            둘 다 설명하려면
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={300}
              required
              placeholder="두 결과를 함께 설명할 수 있도록 처음 생각을 다시 써보세요."
            />
          </label>
          <label>
            언제 생각이 막혔나요?
            <select value={stuck} onChange={(e) => setStuck(e.target.value)}>
              <option value="none">아직 없어요</option>
              <option value="predict">예측할 때</option>
              <option value="observe">관찰한 뒤</option>
              <option value="rewrite">다시 쓸 때</option>
            </select>
          </label>
          <label>
            내가 놓친 것 / 새로 발견한 것
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="예: 물체뿐 아니라 액체도 비교해야 해요"
            />
          </label>
          {text && <Comparison before={r.reason} after={text} />}
          <button className="primary" disabled={busy || !text.trim()}>
            바뀐 생각 저장하기
            <ArrowRight size={16} />
          </button>
        </form>
      )}
      {r.state === "revised" && (
        <>
          <h3>새로운 상황에서도 설명해 볼까요?</h3>
          <p>{items.find((i) => i.id === item.pair)?.description}</p>
          <Prediction
            choices={items.find((i) => i.id === item.pair)!.choices}
            busy={busy}
            onSubmit={(prediction, reason) =>
              act("reassess", { prediction, reason }, r)
            }
          />
        </>
      )}
      {["reassessed", "completed"].includes(r.state) && (
        <>
          <Comparison before={r.reason} after={r.revised_text!} />
          <div className="observation-result">
            <b>새 사례에서의 나의 설명</b>
            <p>{r.re_reason}</p>
          </div>
          <div className="waiting">
            <Check size={28} />
            <h3>
              {r.state === "completed"
                ? "탐구를 끝까지 마쳤어요!"
                : "새 사례 답안이 선생님께 전달됐어요."}
            </h3>
            <p>한 번의 정답보다, 이유를 다시 생각한 과정이 소중해요.</p>
          </div>
          {r.scores && (
            <div className="score-row">
              {["조건 비교", "관찰 증거", "밀도 설명"].map((s, n) => (
                <div key={s}>
                  {s}
                  <strong>{r.scores![n]} / 2</strong>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
function Comparison({ before, after }: { before: string; after: string }) {
  const oldWords = new Set(before.split(/\s+/));
  return (
    <div className="comparison">
      <div>
        <small>처음에는</small>
        <p>{before}</p>
      </div>
      <ArrowRight size={18} />
      <div>
        <small>지금은</small>
        <p>
          {after
            .split(/\s+/)
            .map((w, n) =>
              oldWords.has(w) ? (
                <span key={n}>{w} </span>
              ) : (
                <mark key={n}>{w} </mark>
              ),
            )}
        </p>
      </div>
    </div>
  );
}
function Teacher({ r, act, busy }: { r: RecordRow; act: Act; busy: boolean }) {
  const [h, setH] = useState<Hypothesis>(r.hypothesis),
    [e, setE] = useState(
      r.experiment_id ??
        experiments.find((e) => e.kind === r.hypothesis)?.id ??
        "wood80_iron20",
    ),
    [scores, setScores] = useState([0, 0, 0]);
  return (
    <>
      <div className="section-title">
        <span className="pill peach">개인 근거 카드</span>
        <span className="tiny-pill">{states[r.state]}</span>
      </div>
      <h2>{r.student_alias}의 생각</h2>
      <p className="muted">{items.find((i) => i.id === r.item_id)?.title}</p>
      <div className="original">
        <small>예측 · 학생의 원문</small>
        <b>{r.prediction}</b>
        <p>“{r.reason}”</p>
      </div>
      <div className="ai-card">
        <div>
          <Atom size={18} />
          <b>AI의 가설</b>
          <span className="tiny-pill">
            {r.analysis_mode === "live"
              ? "실시간 분석"
              : r.analysis_mode === "pending"
                ? "분석 대기"
                : "분석 불가 · 직접 검토"}
          </span>
        </div>
        <h3>{hypotheses[r.hypothesis]}</h3>
        <p>
          {r.analysis_note ||
            "AI가 이유를 분석 중입니다. 선생님이 먼저 직접 검토할 수도 있어요."}
        </p>
        <small>가설은 진단이 아닙니다. 원문과 조건을 함께 확인해 주세요.</small>
      </div>
      {["awaiting_review", "needs_more_reason", "experiment_assigned"].includes(
        r.state,
      ) && (
        <>
          <label>
            확인할 가설
            <select
              value={h}
              onChange={(v) => {
                setH(v.target.value as Hypothesis);
                setE(experiments.find((e) => e.kind === v.target.value)!.id);
              }}
            >
              <option value="hold" disabled>
                원문을 읽고 가설을 선택하세요
              </option>
              {Object.entries(hypotheses)
                .filter(([k]) => k !== "hold")
                .map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
            </select>
          </label>
          <label>
            다음 실험
            <select value={e} onChange={(v) => setE(v.target.value)}>
              {experiments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy || h === "hold"}
              onClick={() =>
                act(
                  "review",
                  {
                    decision: h === r.hypothesis ? "confirm" : "edit",
                    hypothesis: h,
                    experiment: e,
                  },
                  r,
                )
              }
            >
              <ShieldCheck size={17} />
              확인하고 실험 열기
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => act("review", { decision: "hold" }, r)}
            >
              보류 · 이유 다시 묻기
            </button>
          </div>
        </>
      )}
      {r.observation && (
        <div className="observation-result">
          <small>가상 실험 관찰 기록</small>
          <p>{r.observation}</p>
        </div>
      )}
      {r.stuck_at && (
        <p>
          막힌 지점 ·{" "}
          {{
            predict: "예측할 때",
            observe: "관찰한 뒤",
            rewrite: "다시 쓸 때",
            none: "없음",
          }[r.stuck_at] || r.stuck_at}
        </p>
      )}
      {r.revised_text && (
        <>
          <Comparison before={r.reason} after={r.revised_text} />
          <p>자기 피드백 · {r.self_note || "없음"}</p>
        </>
      )}
      {r.re_reason && (
        <div className="original">
          <small>새 사례 재확인</small>
          <b>{r.re_prediction}</b>
          <p>{r.re_reason}</p>
        </div>
      )}
      {r.state === "reassessed" && (
        <>
          <h3>준거별 재확인</h3>
          <p className="muted small-text">
            0: 근거 없음 · 1: 일부 설명 · 2: 조건과 증거를 연결
          </p>
          <div className="score-row">
            {["조건 비교", "관찰 증거", "밀도 설명"].map((s, n) => (
              <label key={s}>
                {s}
                <select
                  value={scores[n]}
                  onChange={(e) =>
                    setScores(
                      scores.map((v, i) =>
                        i === n ? Number(e.target.value) : v,
                      ),
                    )
                  }
                >
                  {[0, 1, 2].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            className="primary"
            disabled={busy}
            onClick={() => act("complete", { scores }, r)}
          >
            재확인 완료
            <Check size={17} />
          </button>
        </>
      )}
      {r.state === "completed" && (
        <div className="notice">
          <Check size={18} />
          교사 확인까지 완료된 탐구 기록입니다.
        </div>
      )}
    </>
  );
}
