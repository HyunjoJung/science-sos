"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ChevronLeft, Clock3, FlaskConical, ShieldCheck, Sparkles } from "lucide-react";
import { hypotheses, items, type Hypothesis } from "@/lib/content";

type TrialResult = {
  hypothesis: Hypothesis;
  reason_status: "supported" | "contradictory" | "insufficient";
  evidence: string;
  note: string;
};
type TrialJob = {
  id: string;
  status: "queued" | "running" | "ready" | "error";
  prediction: string;
  reason: string;
  result: TrialResult | null;
  created_at: string;
  finished_at: string | null;
};
type TrialStatus = { online: boolean; remaining: number; job: TrialJob | null };
type Phase = "predict" | "review" | "activity" | "rewrite" | "transfer" | "complete";
type ActivityId = "wood80_iron20" | "split_wood" | "change_liquid";
type LocalFlow = {
  phase: Phase;
  hypothesis: Hypothesis;
  activity: ActivityId;
  decision: "confirm" | "edit" | null;
  played: boolean;
  observation: string;
  revised: string;
  selfNote: string;
  transferPrediction: string;
  transferReason: string;
};
type SavedDraft = {
  version: 1;
  savedAt: number;
  jobId: string | null;
  jobStatus: TrialJob["status"] | null;
  prediction: string;
  reason: string;
  request: { id: string; prediction: string; reason: string } | null;
  flow: LocalFlow;
};

const ITEM = items.find((item) => item.id === "D01")!;
const TRIAL_CHOICES = ITEM.choices.filter((choice) => choice !== "아직 모르겠다");
const TRANSFER = items.find((item) => item.id === "D04")!;
const STORAGE_KEY = "science-sos-live-trial-v1";
const DAY = 24 * 60 * 60 * 1000;
const PHASES: Phase[] = ["predict", "review", "activity", "rewrite", "transfer", "complete"];
const ACTIVITIES = {
  wood80_iron20: {
    title: "무거우면 가라앉을까?",
    condition: "같은 물에서 질량과 재료가 다른 두 물체를 비교해요.",
    left: "나무 80g", right: "철 20g",
    leftDetail: "100cm³ · 밀도 0.80g/cm³", rightDetail: "약 2.56cm³ · 밀도 약 7.81g/cm³",
    leftFloats: true, rightFloats: false, leftMaterial: "wood", rightMaterial: "iron",
    liquidLeft: "물 · 1.00g/cm³", liquidRight: "물 · 1.00g/cm³",
    result: "더 무거운 나무는 뜨고, 더 가벼운 철은 가라앉았어요.",
    prompt: "질량만으로 두 결과를 함께 설명할 수 있나요?",
  },
  split_wood: {
    title: "반으로 나누면 달라질까?",
    condition: "같은 재료의 나무를 반으로 나누어 크기를 바꿔요.",
    left: "원래 나무 80g", right: "절반 나무 40g",
    leftDetail: "100cm³ · 밀도 0.80g/cm³", rightDetail: "50cm³ · 밀도 0.80g/cm³",
    leftFloats: true, rightFloats: true, leftMaterial: "wood", rightMaterial: "wood small",
    liquidLeft: "물 · 1.00g/cm³", liquidRight: "물 · 1.00g/cm³",
    result: "크기와 질량이 줄어도 나누기 전후의 나무는 모두 떠요.",
    prompt: "나누면서 함께 바뀐 값과 그대로인 값은 무엇인가요?",
  },
  change_liquid: {
    title: "액체를 바꾸면 어떨까?",
    condition: "물체는 그대로 두고, 담그는 액체의 밀도만 바꿔요.",
    left: "같은 물체 105g", right: "같은 물체 105g",
    leftDetail: "100cm³ · 밀도 1.05g/cm³", rightDetail: "100cm³ · 밀도 1.05g/cm³",
    leftFloats: false, rightFloats: true, leftMaterial: "iron", rightMaterial: "iron",
    liquidLeft: "액체 A · 1.00g/cm³", liquidRight: "액체 B · 1.10g/cm³",
    result: "같은 물체가 액체 A에서는 가라앉고, 액체 B에서는 떠요.",
    prompt: "물체가 같아도 결과가 달라진 이유는 무엇인가요?",
  },
} as const;

function activityFor(hypothesis: Hypothesis): ActivityId {
  return hypothesis === "size_only" ? "split_wood" : hypothesis === "liquid_missed" ? "change_liquid" : "wood80_iron20";
}
function emptyFlow(): LocalFlow {
  return { phase: "predict", hypothesis: "hold", activity: "wood80_iron20", decision: null, played: false, observation: "", revised: "", selfNote: "", transferPrediction: "", transferReason: "" };
}
function isPending(job: TrialJob | null) { return job?.status === "queued" || job?.status === "running"; }
function errorMessage(code?: string) {
  if (code === "WORKER_OFFLINE") return "지금은 AI 분석 연결이 쉬고 있어요. 입력한 이유는 그대로 두고, 연결 상태를 다시 확인해 주세요.";
  if (code === "RATE_LIMITED") return "오늘 이용할 수 있는 분석 횟수를 모두 사용했거나 전체 체험 한도에 도달했어요. 이미 받은 분석과 다음 활동은 계속 볼 수 있어요.";
  if (code === "CONFLICT") return "이미 진행 중인 분석이 있어요. 상태를 다시 확인해 주세요.";
  return "요청 결과를 확인하지 못했어요. 입력은 보관했어요. 상태를 확인하거나 같은 요청을 다시 보내 주세요.";
}
function readDraft(): SavedDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null") as SavedDraft | null;
    if (!value || value.version !== 1 || Date.now() - value.savedAt > DAY || !PHASES.includes(value.flow?.phase)
      || !(value.flow.activity in ACTIVITIES) || !(value.flow.hypothesis in hypotheses)
      || typeof value.reason !== "string" || typeof value.prediction !== "string"
      || ![value.flow.observation, value.flow.revised, value.flow.selfNote, value.flow.transferPrediction, value.flow.transferReason].every((field) => typeof field === "string")
      || typeof value.flow.played !== "boolean" || ![null, "confirm", "edit"].includes(value.flow.decision)
      || (["activity", "rewrite", "transfer", "complete"].includes(value.flow.phase) && !value.flow.decision)) return null;
    return value;
  } catch { return null; }
}

export default function LiveTrial() {
  const [prediction, setPrediction] = useState("");
  const [reason, setReason] = useState("");
  const [job, setJob] = useState<TrialJob | null>(null);
  const [flow, setFlow] = useState<LocalFlow>(emptyFlow);
  const [online, setOnline] = useState<boolean | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(0);
  const mounted = useRef(false);
  const generation = useRef(0);
  const submitLock = useRef(false);
  const statusLock = useRef(false);
  const statusSequence = useRef(0);
  const jobRef = useRef<TrialJob | null>(null);
  const requestRef = useRef<SavedDraft["request"]>(null);
  const initialDraft = useRef<SavedDraft | null>(null);
  const hydrated = useRef(false);
  const activePost = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pending = isPending(job);
  const elapsed = pending && job ? Math.max(0, Math.floor((now - new Date(job.created_at).getTime()) / 1000)) : 0;
  const longWait = elapsed >= 180;
  const step = Math.min(PHASES.indexOf(flow.phase), 4);

  const acceptJob = useCallback((next: TrialJob | null, restore = false) => {
    const prior = jobRef.current;
    jobRef.current = next;
    setJob(next);
    if (restore) {
      const draft = initialDraft.current;
      const unsentDraft = next && draft?.jobId === next.id && draft.flow.phase === "predict" && ["ready", "error"].includes(draft.jobStatus ?? "") && !isPending(next);
      if (next && !unsentDraft) {
        setPrediction(next.prediction);
        setReason(next.reason);
      }
      if (next?.status === "ready" && next.result) {
        if (draft?.jobId === next.id && (draft.flow.phase !== "predict" || unsentDraft)) setFlow(draft.flow);
        else setFlow({ ...emptyFlow(), phase: "review", hypothesis: next.result.hypothesis, activity: activityFor(next.result.hypothesis) });
      } else if (next) setFlow(emptyFlow());
      return;
    }
    if (next?.status === "ready" && next.result && (prior?.id !== next.id || prior.status !== "ready")) {
      setFlow({ ...emptyFlow(), phase: "review", hypothesis: next.result.hypothesis, activity: activityFor(next.result.hypothesis) });
    }
  }, []);

  const checkStatus = useCallback(async (signal?: AbortSignal, restore = false) => {
    if (statusLock.current && !restore) return;
    statusLock.current = true;
    const statusRequest = ++statusSequence.current;
    const version = generation.current;
    setChecking(true);
    try {
      const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12000)]);
      const response = await fetch("/api/trial", { cache: "no-store", signal: requestSignal });
      const data = await response.json();
      if (!response.ok) throw new Error(errorMessage(data.code));
      if (!mounted.current || signal?.aborted || version !== generation.current || statusRequest !== statusSequence.current) return;
      const status = data as TrialStatus;
      setOnline(status.online);
      setRemaining(status.remaining);
      setInitialized(true);
      setError("");
      acceptJob(status.job, restore);
      if (isPending(status.job) && Date.now() - new Date(status.job!.created_at).getTime() >= 180000) setPaused(true);
    } catch (caught) {
      if (!mounted.current || signal?.aborted || version !== generation.current || statusRequest !== statusSequence.current) return;
      setError(caught instanceof Error && !["TypeError", "AbortError", "TimeoutError"].includes(caught.name) ? caught.message : "연결 상태를 확인하지 못했어요. 입력은 그대로 남아 있어요. 다시 확인해 주세요.");
      setPaused(true);
    } finally {
      if (statusRequest === statusSequence.current) statusLock.current = false;
      if (mounted.current && version === generation.current && statusRequest === statusSequence.current) setChecking(false);
    }
  }, [acceptJob]);

  useEffect(() => {
    mounted.current = true;
    const draft = readDraft();
    initialDraft.current = draft;
    if (draft) {
      setPrediction(draft.prediction);
      setReason(draft.reason);
      requestRef.current = draft.request;
    }
    hydrated.current = true;
    const controller = new AbortController();
    void checkStatus(controller.signal, true);
    return () => {
      mounted.current = false;
      controller.abort();
      activePost.current?.abort();
    };
  }, [checkStatus]);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      const draft: SavedDraft = { version: 1, savedAt: Date.now(), jobId: job?.id ?? null, jobStatus: job?.status ?? null, prediction, reason, request: requestRef.current, flow };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch { /* Browser storage can be unavailable; the active page still works. */ }
  }, [prediction, reason, job?.id, job?.status, flow, busy]);

  useEffect(() => {
    if (!pending) return;
    const tick = () => setNow(Date.now());
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [pending, job?.id]);

  useEffect(() => {
    if (!pending || paused || longWait || busy) return;
    const controller = new AbortController();
    const interval = window.setInterval(() => { void checkStatus(controller.signal); }, 3000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [pending, paused, longWait, busy, job?.id, checkStatus]);

  useEffect(() => {
    if (initialized) headingRef.current?.focus({ preventScroll: true });
  }, [flow.phase, initialized]);

  async function analyze() {
    if (submitLock.current || pending || !initialized || !prediction || !reason.trim()) return;
    submitLock.current = true;
    generation.current += 1;
    const version = generation.current;
    const content = reason.trim();
    if (!requestRef.current || requestRef.current.reason !== content || requestRef.current.prediction !== prediction) {
      requestRef.current = { id: crypto.randomUUID(), reason: content, prediction };
    }
    const request = requestRef.current;
    const controller = new AbortController();
    activePost.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    setBusy(true);
    setError("");
    setPaused(false);
    setHeld(false);
    try {
      const response = await fetch("/api/trial", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: request.id, prediction, reason: content }), signal: controller.signal,
      });
      const data = await response.json();
      if (!mounted.current || version !== generation.current) return;
      if (!response.ok) {
        if (data.code === "WORKER_OFFLINE") setOnline(false);
        if (data.code === "RATE_LIMITED") setRemaining(0);
        throw new Error(errorMessage(data.code));
      }
      setReason(content);
      setNow(Date.now());
      setFlow(emptyFlow());
      acceptJob(data.job as TrialJob);
      setRemaining((value) => value === null ? null : Math.max(0, value - 1));
      setOnline(true);
    } catch (caught) {
      if (!mounted.current || version !== generation.current) return;
      setError(caught instanceof Error && !["AbortError", "TypeError"].includes(caught.name) ? caught.message : "분석 요청의 접수 결과를 확인하지 못했어요. 상태를 확인하거나 같은 요청을 다시 보내 주세요.");
    } finally {
      window.clearTimeout(timeout);
      submitLock.current = false;
      if (mounted.current && version === generation.current) { setBusy(false); setChecking(false); }
    }
  }

  function changeInput(kind: "prediction" | "reason", value: string) {
    requestRef.current = null;
    if (kind === "prediction") setPrediction(value); else setReason(value);
  }
  function updateFlow(next: Partial<LocalFlow>) { setFlow((current) => ({ ...current, ...next })); }
  function beginAgain(hold = false) {
    requestRef.current = null;
    setFlow(emptyFlow());
    setHeld(hold);
    setError("");
  }
  function manualCheck() { setPaused(false); void checkStatus(undefined, !initialized); }
  const result = job?.status === "ready" ? job.result : null;
  const activity = ACTIVITIES[flow.activity];

  return (
    <div id="science-trial">
      <nav className="trial-topnav" aria-label="교실 이동">
        <Link href="/"><ChevronLeft size={14} /> 실제 수업 로그인</Link>
        <Link href="/demo">가상 학급 둘러보기 <ArrowRight size={14} /></Link>
      </nav>
      <div className="trial-shell">
        <header className="trial-header">
          <Link href="/" className="trial-brand"><span><FlaskConical size={23} /></span><div><b>과학SOS</b><small>THINK. ASK. DISCOVER.</small></div></Link>
          <div className="trial-header-right"><span className="trial-tag">로그인 없이 직접 AI 체험</span><span className={`trial-connection ${online === true ? "online" : ""}`}><i />{online === null ? "연결 확인 중" : online ? "AI 연결됨" : "AI 연결 대기"}</span></div>
        </header>
        <div className="trial-layout">
          <aside className="trial-sidebar">
            <span className="trial-eyebrow">나의 생각에서 시작하는 탐구</span>
            <h2>같은 답 속의<br />다른 이유.</h2>
            <p>내 이유를 AI가 읽고,<br />사람이 다음 질문을 골라요.</p>
            <ol className="trial-steps" aria-label="체험 순서">
              {["예측과 이유", "교사 역할로 확인", "반례 관찰", "설명 다시 쓰기", "새 사례에 적용"].map((label, index) => <li key={label} className={index === step ? "current" : index < step ? "done" : ""} aria-current={index === step ? "step" : undefined}><span>{index < step ? <Check size={13} /> : index + 1}</span>{label}</li>)}
            </ol>
            <div className="trial-side-note"><ShieldCheck size={18} /><b>AI는 가설을 제안해요.</b><p>원문을 확인하고 활동을 여는 결정은 사람이 해요.</p></div>
            <div className="trial-quota">{remaining === null ? "연결되면 남은 횟수가 표시돼요" : `오늘 남은 AI 분석 ${remaining}회 / 최대 3회`}<small>이 브라우저 기준 · 전체 이용 한도 별도</small></div>
          </aside>
          <main className="trial-main">
            <div className="trial-section-title"><span className="trial-eyebrow">직접 쓰고, 직접 확인하는 5단계</span><span className="trial-topic">중등 과학 · 질량과 밀도</span></div>
            <h1 ref={headingRef} tabIndex={-1}>{flow.phase === "predict" ? "왜 그렇게 생각했나요?" : flow.phase === "review" ? "AI의 가설을 직접 살펴봐요." : flow.phase === "activity" ? "예측과 다른 장면을 찾아요." : flow.phase === "rewrite" ? "처음의 설명이 어떻게 달라졌나요?" : flow.phase === "transfer" ? "새로운 물체도 설명할 수 있나요?" : "생각의 변화를 남겼어요."}</h1>
            <p className="trial-lead">{flow.phase === "predict" ? "정답보다 먼저, 판단의 이유를 한 문장으로 들려주세요." : flow.phase === "review" ? "이번에는 교사 역할이에요. 원문을 읽고 가설과 활동을 확인하세요." : flow.phase === "activity" ? "선택한 조건을 바꿔 보고, 실제로 화면에서 확인한 내용을 적어요." : flow.phase === "rewrite" ? "관찰한 결과를 근거로, 두 경우를 함께 설명하는 문장을 써보세요." : flow.phase === "transfer" ? "같은 원리가 새로운 조건에서도 통하는지 생각해 보세요." : "예측부터 관찰, 설명 수정, 새 사례까지 하나의 탐구를 경험했어요."}</p>

            {error && <div className="trial-alert" role="alert"><p>{error}</p><div className="trial-actions"><button className="trial-secondary" onClick={manualCheck} disabled={checking || busy}>{checking ? "확인 중…" : "상태 다시 확인"}</button><Link href="/demo">사전 작성된 가상 학급 보기 →</Link></div></div>}

            {flow.phase === "predict" && <>
              {held && <div className="trial-notice"><b>보류했어요 · 이유를 한 번 더 물어요.</b><p>어떤 조건을 비교했나요? 그 조건이 결과와 어떻게 연결되는지 이유를 보완해 주세요.</p></div>}
              <section className="trial-card">
                <div className="trial-card-heading"><span className="trial-number">01</span><div><h2>{ITEM.title}</h2><p>{ITEM.description}</p></div></div>
                <div className="trial-object-pair">{ITEM.objects.map((object) => <div key={object.name}><span className={`trial-specimen ${object.color}`} aria-hidden="true" /><div><strong>{object.name} <b>{object.mass}</b></strong><small>{object.detail}</small></div></div>)}</div>
                <form onSubmit={(event) => { event.preventDefault(); void analyze(); }}>
                  <fieldset disabled={!initialized || pending || busy}><legend>나의 예측</legend><div className="trial-choices">{TRIAL_CHOICES.map((choice) => <label key={choice} className={prediction === choice ? "selected" : ""}><input required type="radio" name="trial-prediction" value={choice} checked={prediction === choice} onChange={() => changeInput("prediction", choice)} />{choice}</label>)}</div>
                    <label className="trial-label" htmlFor="trial-reason">그렇게 생각한 이유 <span>한 문장이면 충분해요</span></label><textarea id="trial-reason" value={reason} onChange={(event) => changeInput("reason", event.target.value)} required maxLength={300} rows={3} placeholder="어떤 조건을 보고 그렇게 예상했나요?" aria-describedby="trial-reason-help" /><div id="trial-reason-help" className="trial-input-help"><span>이름·학교·연락처를 쓰지 않아도 돼요.</span><span>{reason.length} / 300</span></div>
                  </fieldset>
                  {!pending && <div className="trial-actions"><button className="trial-primary" disabled={busy || !initialized || online !== true || (!requestRef.current && remaining === 0) || !prediction || !reason.trim()}><Sparkles size={16} />{busy ? "분석 요청 중…" : "내 이유를 AI로 분석하기"}<ArrowRight size={16} /></button>{result && <button type="button" className="trial-secondary" onClick={() => updateFlow({ phase: "review", hypothesis: result.hypothesis, activity: activityFor(result.hypothesis) })}>앞선 분석 보기</button>}</div>}
                </form>
              </section>
              {pending && <section className="trial-waiting" aria-live="polite"><Clock3 size={25} /><div><h3>{job?.status === "running" ? "AI가 지금 이 이유를 읽고 있어요." : "분석 순서를 기다리고 있어요."}</h3><p>{longWait || paused ? "자동 확인을 멈췄어요. 아래 버튼으로 결과를 다시 확인할 수 있어요." : "완료되면 원문 근거와 가설이 여기에 나타나요. 보통 수십 초가 걸릴 수 있어요."}</p><span>{elapsed}초 경과 · {job?.status === "running" ? "분석 중" : "대기 중"}</span>{(longWait || paused) && <button className="trial-secondary" disabled={checking} onClick={manualCheck}>{checking ? "확인 중…" : "분석 결과 다시 확인"}</button>}</div></section>}
              {job?.status === "error" && <div className="trial-alert" role="alert"><b>분석을 마치지 못했어요.</b><p>완성된 가설이 없어 활동을 열지 않았어요. 연결 상태를 확인한 뒤 다시 요청할 수 있어요.</p><button className="trial-secondary" onClick={() => { requestRef.current = null; void analyze(); }} disabled={busy || online !== true || remaining === 0}>새 분석 요청하기</button></div>}
              {online === false && !error && <div className="trial-notice"><b>AI 연결을 기다리고 있어요.</b><p>작성한 이유는 그대로 남아 있어요. 연결을 확인하거나 가상 학급의 수업 흐름을 먼저 둘러보세요.</p><div className="trial-actions"><button className="trial-secondary" disabled={checking} onClick={manualCheck}>연결 다시 확인</button><Link href="/demo">가상 학급 둘러보기 →</Link></div></div>}
            </>}

            {flow.phase === "review" && result && job && <>
              <div className="trial-review-grid"><section className="trial-card"><span className="trial-eyebrow">학생 역할에서 남긴 원문</span><h3>{job.prediction}</h3><blockquote>{job.reason}</blockquote><p className="trial-caption">가설의 근거가 실제 문장에 있는지 확인해 보세요.</p></section><section className="trial-card trial-ai-card"><span className="trial-tag"><Sparkles size={13} /> 이 입력으로 생성한 AI 분석</span><h2>{hypotheses[result.hypothesis]}</h2><p>{result.note}</p>{result.evidence && <div className="trial-evidence"><small>AI가 짚은 원문 근거</small><q>{result.evidence}</q></div>}<span className="trial-reason-status">{result.reason_status === "insufficient" ? "이유를 더 물어볼 필요가 있어요" : result.reason_status === "contradictory" ? "예측과 이유의 연결을 확인해요" : "원문의 근거를 함께 살펴봐요"}</span></section></div>
              <section className="trial-card">
                <div className="trial-card-heading"><span className="trial-number">02</span><div><h2>교사 역할로 확인하기</h2><p>가설을 확인하거나 수정해요. 판단하기 어렵다면 이유를 다시 물을 수 있어요.</p></div></div>
                <div className="trial-two-fields">
                  <div><label htmlFor="trial-hypothesis" className="trial-label">확인할 가설</label><select id="trial-hypothesis" value={flow.hypothesis} onChange={(event) => { const hypothesis = event.target.value as Hypothesis; updateFlow({ hypothesis, activity: activityFor(hypothesis) }); }}>{Object.entries(hypotheses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
                  <div><label htmlFor="trial-activity" className="trial-label">함께 볼 반례 활동</label><select id="trial-activity" value={flow.activity} onChange={(event) => updateFlow({ activity: event.target.value as ActivityId })}>{Object.entries(ACTIVITIES).map(([value, valueData]) => <option value={value} key={value}>{valueData.title}</option>)}</select></div>
                </div>
                <div className="trial-notice"><b>선택한 활동 · {activity.title}</b><p>{activity.condition}</p></div>
                <div className="trial-actions"><button className="trial-primary" disabled={flow.hypothesis === "hold"} onClick={() => updateFlow({ phase: "activity", decision: flow.hypothesis === result.hypothesis ? "confirm" : "edit" })}><ShieldCheck size={16} />{flow.hypothesis === result.hypothesis ? "확인하고 반례 활동 열기" : "수정하고 반례 활동 열기"}</button><button className="trial-secondary" onClick={() => beginAgain(true)}>보류 · 이유 다시 묻기</button></div>
                {flow.hypothesis === "hold" && <p className="trial-caption">추가 설명이 필요하면 보류하세요. 활동을 열려면 원문을 확인해 가설을 선택하세요.</p>}
              </section>
            </>}

            {flow.phase === "activity" && flow.decision && <section className="trial-card"><div className="trial-card-heading"><span className="trial-number">03</span><div><h2>{activity.title}</h2><p>{activity.condition}</p></div><span className="trial-tag">교사 역할로 {flow.decision === "edit" ? "수정" : "확인"}함</span></div><div className="trial-tanks">{["left", "right"].map((side) => { const left = side === "left"; const floats = left ? activity.leftFloats : activity.rightFloats; return <div className="trial-tank-unit" key={side}><b>{left ? activity.left : activity.right}</b><small>{left ? activity.leftDetail : activity.rightDetail}</small><div className={`trial-tank ${flow.played ? "played" : ""}`} role="img" aria-label={`${left ? activity.left : activity.right}: ${flow.played ? floats ? "뜸" : "가라앉음" : "관찰 전"}`}><div className="trial-water" /><div className={`trial-floating-object ${left ? activity.leftMaterial : activity.rightMaterial} ${floats ? "floats" : "sinks"}`} /><span>{flow.played ? floats ? "떠요" : "가라앉아요" : "관찰 전"}</span></div><small>{left ? activity.liquidLeft : activity.liquidRight}</small></div>; })}</div><p className="trial-caption">이상화한 가상 실험 · 물체의 평균 밀도와 액체 밀도를 비교해 부유 여부를 표현해요.</p><button className="trial-secondary" onClick={() => updateFlow({ played: !flow.played })}><FlaskConical size={16} />{flow.played ? "실험 처음으로" : "실험 시작"}</button>{flow.played && <><div className="trial-observed"><b>{activity.result}</b><p>{activity.prompt}</p></div><form onSubmit={(event) => { event.preventDefault(); updateFlow({ phase: "rewrite" }); }}><label htmlFor="trial-observation" className="trial-label">무엇을 봤나 <span>내 예측과 비교해요</span></label><textarea id="trial-observation" value={flow.observation} onChange={(event) => updateFlow({ observation: event.target.value })} required maxLength={300} rows={3} placeholder="두 결과에서 어떤 차이 또는 공통점을 확인했나요?" /><div className="trial-actions"><button className="trial-primary" disabled={!flow.observation.trim()}>관찰을 남기고 설명 다시 쓰기 <ArrowRight size={16} /></button></div></form></>}</section>}

            {flow.phase === "rewrite" && job && <section className="trial-card"><div className="trial-observed"><small>내가 확인한 관찰</small><p>{flow.observation}</p></div><form onSubmit={(event) => { event.preventDefault(); updateFlow({ phase: "transfer" }); }}><label htmlFor="trial-revised" className="trial-label">둘 다 설명하려면</label><textarea id="trial-revised" value={flow.revised} onChange={(event) => updateFlow({ revised: event.target.value })} required maxLength={300} rows={3} placeholder="처음의 이유에 어떤 조건과 관찰을 더해야 할까요?" /><label htmlFor="trial-self-note" className="trial-label">내가 놓친 것 / 새로 발견한 것 <span>선택</span></label><input id="trial-self-note" value={flow.selfNote} onChange={(event) => updateFlow({ selfNote: event.target.value })} maxLength={150} placeholder="스스로 남기는 짧은 피드백" />{flow.revised && <Comparison before={job.reason} after={flow.revised} />}<div className="trial-actions"><button className="trial-primary" disabled={!flow.revised.trim()}>새 사례에 적용하기 <ArrowRight size={16} /></button><button type="button" className="trial-secondary" onClick={() => updateFlow({ phase: "activity" })}>관찰 다시 보기</button></div></form></section>}

            {flow.phase === "transfer" && <section className="trial-card"><div className="trial-card-heading"><span className="trial-number">05</span><div><h2>이번에는 A와 B예요.</h2><p>{TRANSFER.description}</p></div></div><div className="trial-transfer-pair"><div><b>물체 A</b><strong>60g <span>/ 100cm³</span></strong></div><div><b>물체 B</b><strong>30g <span>/ 10cm³</span></strong></div></div><form onSubmit={(event) => { event.preventDefault(); updateFlow({ phase: "complete" }); }}><fieldset><legend>새로운 예측</legend><div className="trial-choices">{TRANSFER.choices.map((choice) => <label key={choice} className={flow.transferPrediction === choice ? "selected" : ""}><input type="radio" name="trial-transfer" required value={choice} checked={flow.transferPrediction === choice} onChange={() => updateFlow({ transferPrediction: choice })} />{choice}</label>)}</div></fieldset><label htmlFor="trial-transfer-reason" className="trial-label">같은 원리로 이유를 설명해요</label><textarea id="trial-transfer-reason" value={flow.transferReason} onChange={(event) => updateFlow({ transferReason: event.target.value })} required rows={3} maxLength={300} /><div className="trial-actions"><button className="trial-primary" disabled={!flow.transferPrediction || !flow.transferReason.trim()}>내 탐구 기록 마무리 <Check size={16} /></button></div></form></section>}

            {flow.phase === "complete" && job && <section className="trial-card"><div className="trial-complete"><span><Check size={25} /></span><div><h2>답보다 이유의 변화를 보세요.</h2><p>이 기록은 현재 브라우저 탭에만 남는 체험 기록이에요.</p></div></div><Comparison before={job.reason} after={flow.revised} /><dl className="trial-summary"><div><dt>사람이 확인한 가설</dt><dd>{hypotheses[flow.hypothesis]} · {flow.decision === "edit" ? "수정" : "확인"}</dd></div><div><dt>내가 관찰한 내용</dt><dd>{flow.observation}</dd></div>{flow.selfNote && <div><dt>나의 피드백</dt><dd>{flow.selfNote}</dd></div>}<div><dt>새 사례에 적용</dt><dd><b>{flow.transferPrediction}</b><p>{flow.transferReason}</p></dd></div></dl><details className="trial-reference"><summary>새 사례의 과학 개념 확인</summary><p>A의 밀도는 0.60g/cm³, B는 3.00g/cm³예요. 물의 밀도 1.00g/cm³와 비교하면 A는 뜨고 B는 가라앉아요. 질량만이 아니라 물체와 액체의 밀도를 함께 비교했는지 내 문장을 살펴보세요.</p></details><p className="trial-caption">이 마지막 설명은 고정된 개념 자료예요. 새 사례 답안을 AI가 채점하거나 교사가 평가한 결과는 아니에요.</p><div className="trial-actions"><button className="trial-primary" onClick={() => beginAgain()}>이유를 바꿔 다시 탐구하기 <ArrowRight size={16} /></button><Link href="/demo" className="trial-secondary">교사의 가상 학급 둘러보기</Link></div></section>}
            <footer className="trial-footer"><p>내 예측·이유와 AI 분석은 최대 24시간 동안 조회할 수 있어요. 교사 역할의 선택과 이후 탐구 기록은 이 탭에만 보관되며 실제 학급 기록에 반영되지 않아요.</p><span>실제 AI 분석 → 사람이 확인 → 반례 → 설명의 변화</span></footer>
          </main>
        </div>
      </div>
    </div>
  );
}

function Comparison({ before, after }: { before: string; after: string }) {
  const originalWords = new Set(before.split(/\s+/));
  return <div className="trial-comparison"><div><small>처음의 이유</small><p>{before}</p></div><div><small>관찰 후 나의 설명</small><p>{after.split(/(\s+)/).map((word, index) => originalWords.has(word) || !word.trim() ? <span key={index}>{word}</span> : <mark key={index}>{word}</mark>)}</p><span>처음 문장에 없던 말을 표시했어요.</span></div></div>;
}
