"use client";
import { useEffect, useState } from "react";
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
  lessons,
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
export function Student({
  r,
  act,
  busy,
}: {
  r: RecordRow;
  act: Act;
  busy: boolean;
}) {
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
            {r.teacher_question ||
              "어떤 조건을 보고 그렇게 생각했나요? 이유를 조금 더 설명해 주세요."}
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
      {r.state === "experiment_assigned" && exp?.id === "guided" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act("observe", { observation: text }, r);
          }}
        >
          <div className="ss-ai">
            <span className="ss-pill teal">선생님이 보낸 탐구 활동</span>
            <strong>{lessons.find((l) => l.id === r.item_id)?.followup}</strong>
            <p>
              조건을 비교하고 선생님과 자료 또는 실험을 살펴본 뒤, 확인한 내용을
              직접 기록해요.
            </p>
          </div>
          <label>
            내가 확인하고 관찰한 내용
            <textarea
              required
              maxLength={500}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="무엇을 비교했고, 어떤 결과를 확인했나요?"
            />
          </label>
          <button className="primary" disabled={busy || !text.trim()}>
            관찰 기록 저장하기 →
          </button>
        </form>
      )}
      {r.state === "experiment_assigned" && exp && exp.id !== "guided" && (
        <div className="experiment">
          <div className="section-title">
            <h3>직접 관찰해 볼까요?</h3>
            <span className="pill soft">
              <ShieldCheck size={13} />
              교사 승인 완료
            </span>
          </div>
          <p>내 예측과 다른 점을 찾아보세요.</p>
          <div className="notice">
            {exp.id === "wood80_iron20"
              ? "언제 · 더 무거운 물체가 뜰 수도 있을까요? 무엇을 봤나 · 두 물체의 결과를 내 예측과 비교해요."
              : exp.id === "split_wood"
                ? "언제 · 같은 나무를 나누면 어떤 값이 함께 바뀔까요? 무엇을 봤나 · 나누기 전후를 비교해요."
                : "언제 · 물체는 그대로인데 결과가 바뀔까요? 둘 다 설명하려면 · 달라진 액체 조건을 찾아요."}
          </div>
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
              {["조건 비교", "관찰 증거", "개념 설명"].map((s, n) => (
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
export function Teacher({
  r,
  act,
  busy,
}: {
  r: RecordRow;
  act: Act;
  busy: boolean;
}) {
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
          <b>{r.experiment_id ? "검토한 가설" : "AI의 가설"}</b>
          <span className="tiny-pill">
            {r.analysis_mode === "live"
              ? "실시간 분석"
              : r.experiment_id
                ? "교사 직접 검토"
                : r.analysis_mode === "pending" && r.state === "awaiting_review"
                  ? "분석 대기"
                  : "분석 불가 · 직접 검토"}
          </span>
        </div>
        <h3>{hypotheses[r.hypothesis]}</h3>
        <p>
          {r.analysis_note ||
            (r.experiment_id
              ? "선생님이 원문을 읽고 가설과 실험을 선택했습니다."
              : "AI 분석을 기다리고 있습니다. 선생님이 먼저 직접 검토할 수도 있어요.")}
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
            {["조건 비교", "관찰 증거", "개념 설명"].map((s, n) => (
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
