'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import LearningResources, {type LearningResource} from './LearningResources';
import { createLatestRequest, createMutationClient, getJson } from '@/lib/runtime/client.mjs';
import { attemptDraftKey, reconcileAttemptSelection } from '@/lib/learning/view-state.mjs';

type Course={id:string;title:string;role:'teacher'|'student'};
type Activity={id:string;kind:string;title:string;instruction:string;cases?:{label:string;value:string}[];denominators?:number[]};
type Item={prompt:string;choices:string[];correctAnswer?:string};
type Pack=Item&{id:string;version:string;title:string;subject:string;scope:string;rubric:string;reviewNotice:string;activities:Activity[];transfer:Item};
type Assignment=Item&{id:string;pack_id:string;pack_version:string;title:string;subject:string};
type Attempt={resource_revision?:number;resource_candidates?:LearningResource[];shared_resources?:LearningResource[];id:string;student_id:string;title:string;stage:string;version:number;created_at:string;prompt:string;choices:string[];
 response:{answer:string;reason:string};teacher_feedback?:string;final_feedback?:string;
 activity?:Activity;activities?:Activity[];activity_response?:{observation:string;explanation:string};transfer?:Item;transfer_response?:{answer:string;reason:string};
 analysis?:{resourceLookup?:{transport:string;status:string;catalogVersion:string};interpretation:string;evidence:string;quote:string;note:string;ruleVerdict:string;model:string;promptVersion:string;proposal:{kind:string}};
 job?:{status:string;error_code?:string;attempts:number;available_at:string}};
type View={user_id:string;courses:Course[];course_id:string;role:string;attempts:Attempt[];assignments:Assignment[];catalog:Pack[];has_more:boolean};
const empty:View={user_id:'',courses:[],course_id:'',role:'',attempts:[],assignments:[],catalog:[],has_more:false};
const stages:Record<string,string>={awaiting_review:'교사 확인 대기',needs_clarification:'설명 보완',activity_assigned:'확인 활동',awaiting_transfer:'새 문항 확인',awaiting_final_review:'최종 교사 확인',completed:'완료'};
const interpretations:Record<string,string>={understood:'개념 이해 근거',misconception:'오개념 가설',uncertain:'추가 확인 필요',out_of_scope:'범위 확인 필요',ambiguous_item:'문항 확인 필요'};
const proposalLabels:Record<string,string>={transfer_check:'새 문항으로 확인',activity_proposal:'확인 활동 제안',clarification:'설명 보완 질문',item_review:'문항·범위 검토',conflicting_evidence_review:'상충하는 근거 검토',operational_review:'직접 검토'};
type Act=(action:string,data:Record<string,unknown>,id:string,version?:number)=>Promise<boolean>;

export default function LearningWorkspace(){
 const [view,setView]=useState<View>(empty),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[notice,setNotice]=useState('');
 const [selected,setSelected]=useState('');
 const client=useRef(createMutationClient({storage:()=>window.sessionStorage}));
 const latest=useRef(createLatestRequest());
 const writing=useRef(false),mounted=useRef(true),knownUser=useRef(''),course=useRef('');
 const cursor=useRef<{before:string;before_id:string}|null>(null);
 const refresh=useCallback(async()=>{
  const request=latest.current.begin();setRefreshing(true);
  try{
   const home=await getJson('/api/learning',request.signal);
   if(!request.isCurrent()||!mounted.current)return false;
   if(typeof home.user_id!=='string'||!Array.isArray(home.courses))throw Error('수업 응답을 확인하지 못했어요.');
   if(knownUser.current && knownUser.current!==home.user_id){course.current='';cursor.current=null;setSelected('');setView(empty);setError('');setNotice('');}
   knownUser.current=home.user_id;
   const active:Course|undefined=home.courses.find((c:Course)=>c.id===course.current)||home.courses[0];
   if(!active){course.current='';cursor.current=null;setSelected('');setView({...empty,user_id:home.user_id});setLoadError('');return true;}
   if(course.current!==active.id){cursor.current=null;setSelected('');}
   course.current=active.id;
   const query=new URLSearchParams({course:active.id,...cursor.current});
   const data=await getJson('/api/learning?'+query,request.signal);
   if(!request.isCurrent()||!mounted.current)return false;
   if(data.user_id!==home.user_id){knownUser.current='';setView(empty);throw Error('계정이 변경됐어요. 다시 불러와 주세요.');}
   if(!Array.isArray(data.attempts)||!Array.isArray(data.assignments)||!Array.isArray(data.catalog))throw Error('수업 응답을 확인하지 못했어요.');
   setView({...data,courses:home.courses});setSelected(value=>reconcileAttemptSelection(data.attempts,value));setLoadError('');return true;
  }catch(e){
   if(request.isCurrent()&&mounted.current){
    if((e as {status?:number}).status===401){knownUser.current='';course.current='';cursor.current=null;setSelected('');setView(empty);setLoadError('');}
    else setLoadError(e instanceof Error?e.message:'수업 연결을 확인해 주세요.');
   }return false;
  }finally{if(request.isCurrent()&&mounted.current){setLoading(false);setRefreshing(false);}}
 },[]);
 useEffect(()=>{
  mounted.current=true;let ended=false;let timer:ReturnType<typeof setTimeout>;
  const tick=async()=>{if(!document.hidden&&!writing.current)await refresh();if(!ended)timer=setTimeout(tick,5000);};
  void tick();
  return()=>{ended=true;mounted.current=false;clearTimeout(timer);latest.current.cancel();};
 },[refresh]);
 const act:Act=async(action,data,id,version)=>{
  if(writing.current)return false;
  writing.current=true;latest.current.cancel();setBusy(true);setError('');setNotice('');
  try{
   const result=await client.current.send(knownUser.current,'/api/learning',action,data,id,version??null);
   if(!mounted.current)return true;
   if(action==='submit'){cursor.current=null;setSelected(result.id??'');}
   const fresh=await refresh();
   setNotice(fresh?'저장했어요.':'저장은 완료됐어요. 최신 화면을 다시 불러와 주세요.');return true;
  }catch(e){if(mounted.current){setError(e instanceof Error?e.message:'저장하지 못했어요.');if([401,409].includes((e as {status?:number}).status??0))await refresh();}return false;}
  finally{writing.current=false;if(mounted.current){setBusy(false);setRefreshing(false);}}
 };
 async function authenticate(action:'login'|'logout',data:Record<string,unknown>){
  if(writing.current)return;writing.current=true;latest.current.cancel();setBusy(true);setError('');setNotice('');
  if(action==='logout'){knownUser.current='';course.current='';cursor.current=null;setView(empty);setSelected('');}
  try{
   await client.current.send('guest','/api/lab',action,data);
   cursor.current=null;await refresh();
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'로그인 연결을 확인해 주세요.');}
  finally{writing.current=false;if(mounted.current){setBusy(false);setRefreshing(false);}}
 }
 const current=view.attempts.find(a=>a.id===selected)||view.attempts[0];
 return <main className="learning-shell">
  <header className="learning-header"><div><h1>학습SOS</h1><p>생각을 확인하고, 근거로 다시 설명해요.</p></div><a href="/">기존 과학 교실</a><a href="/integrations">MCP 연결 안내</a>
   {view.user_id&&<button disabled={busy} onClick={()=>void authenticate('logout',{})}>로그아웃</button>}</header>
  {error&&<div role="alert" className="learning-alert">{error} <button onClick={()=>setError('')}>닫기</button></div>}
  {loadError&&<div role="alert" className="learning-alert">{loadError} <button disabled={busy||refreshing} onClick={()=>void refresh()}>다시 불러오기</button> <button onClick={()=>setLoadError('')}>닫기</button></div>}
  {notice&&<p role="status">{notice}</p>}
  {loading?<p role="status">수업을 불러오고 있어요.</p>:!view.user_id?<section className="learning-card"><h2>수업에 들어가기</h2>
   <p>배정받은 기존 학생·교사 계정으로 로그인하세요.</p>
   <form onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void authenticate('login',{email:form.get('email'),password:form.get('password')});}}>
    <label>이메일<input name="email" type="email" autoComplete="username" required disabled={busy}/></label>
    <label>비밀번호<input name="password" type="password" autoComplete="current-password" required disabled={busy}/></label>
    <button disabled={busy}>{busy?'로그인 중…':'로그인'}</button></form></section>:<>
   <div className="learning-toolbar"><label>수업<select value={view.course_id} disabled={busy||refreshing} onChange={e=>{
    latest.current.cancel();course.current=e.target.value;cursor.current=null;setSelected('');setView(v=>({...empty,user_id:v.user_id,courses:v.courses,course_id:e.target.value}));void refresh();
   }}>{view.courses.map(c=><option key={c.id} value={c.id}>{c.title} · {c.role==='teacher'?'교사':'학생'}</option>)}</select></label>
   <button disabled={busy||refreshing} onClick={()=>void refresh()}>다시 불러오기</button>{busy&&<span role="status">저장 중이에요.</span>}</div>
   {!view.courses.length?<p>아직 등록된 수업이 없어요. 담당 관리자에게 수업 등록을 요청하세요.</p>:<div key={JSON.stringify([view.user_id,view.course_id,view.role])}>
    {view.role==='teacher'&&<section className="learning-card"><h2>수업 팩 검토·배정</h2><p>아래 자료는 작성 예시입니다. 정답·범위·활동을 직접 검토한 뒤 이 반에 배정하세요.</p>
     {!view.catalog.length&&<p>등록된 팩이 없어요. 관리자가 콘텐츠 등록 명령을 실행해야 합니다.</p>}
     {view.catalog.map(p=><PackReview key={p.id+p.version} pack={p} busy={busy} assigned={view.assignments.some(a=>a.pack_id===p.id&&a.pack_version===p.version)} activate={()=>act('activate_pack',{pack_id:p.id,pack_version:p.version,reviewed:true},view.course_id)}/>)}</section>}
    {view.role==='student'&&<section className="learning-card"><h2>배정된 질문</h2>{!view.assignments.length&&<p>선생님이 팩을 검토하고 배정하면 여기에 표시돼요.</p>}
     {view.assignments.map(a=><details key={a.id}><summary>{a.title} · v{a.pack_version}</summary><AnswerForm key={a.id} item={a} busy={busy} label="내 생각 보내기" onSend={d=>act('submit',d,a.id)}/></details>)}</section>}
    <section className="learning-card"><h2>{view.role==='teacher'?'학생 생각 검토':'내 학습 기록'}</h2>
     <p>AI 제안은 확정 진단이 아닙니다. 연결 실패나 근거 부족도 교사가 원문을 보고 이어갈 수 있어요.</p>
     {!view.attempts.length?<p>아직 기록이 없어요.</p>:<>
      <label>기록 선택<select value={current?.id??''} onChange={e=>setSelected(e.target.value)} disabled={busy||refreshing}>{view.attempts.map(a=><option key={a.id} value={a.id}>{a.title} · {stages[a.stage]} · {new Date(a.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · {a.student_id.slice(0,8)}</option>)}</select></label>
      {current&&<AttemptPanel key={attemptDraftKey(view,current)} row={current} teacher={view.role==='teacher'} act={act} busy={busy}/>}</>}
     <div className="learning-toolbar"><button disabled={busy||refreshing||!cursor.current} onClick={()=>{cursor.current=null;setSelected('');void refresh();}}>최신 기록</button>
      <button disabled={busy||refreshing||!view.has_more} onClick={()=>{const last=view.attempts.at(-1);if(last){cursor.current={before:last.created_at,before_id:last.id};setSelected('');void refresh();}}}>이전 기록</button></div>
    </section>
   </div>}
  </>}
 </main>;
}
function PackReview({pack:p,busy,assigned,activate}:{pack:Pack;busy:boolean;assigned:boolean;activate:()=>Promise<boolean>}){
 const [reviewed,setReviewed]=useState(false);
 return <details><summary>{p.title} · {p.version}{assigned?' · 배정됨':''}</summary><p>{p.reviewNotice}</p><h3>범위</h3><p>{p.scope}</p><h3>문항</h3><p>{p.prompt}</p><p>정답: {p.correctAnswer}</p><h3>검토 기준</h3><p>{p.rubric}</p>
  {p.activities.map(a=><ActivityView activity={a} key={a.id}/>)}<h3>재확인</h3><p>{p.transfer.prompt}</p><p>정답: {p.transfer.correctAnswer}</p>
  <label className="learning-check"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>내용과 수업 적합성을 검토했습니다.</label>
  <button disabled={busy||!reviewed||assigned} onClick={()=>void activate()}>이 반에 배정</button></details>;
}
function AnswerForm({item,busy,label,onSend}:{item:Item;busy:boolean;label:string;onSend:(d:Record<string,unknown>)=>Promise<boolean>}){
 const [answer,setAnswer]=useState(''),[reason,setReason]=useState('');
 const answerId=useId(),reasonId=useId();
 return <form onSubmit={async e=>{e.preventDefault();if(await onSend({answer,reason})){setAnswer('');setReason('');}}}><p>{item.prompt}</p>
  <label htmlFor={answerId}>내 답</label><select id={answerId} required disabled={busy} value={answer} onChange={e=>setAnswer(e.target.value)}><option value="">선택하세요</option>{item.choices.map(c=><option key={c} value={c}>{c}</option>)}</select>
  <label htmlFor={reasonId}>그렇게 생각한 이유</label><textarea id={reasonId} required disabled={busy} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/>
  <button disabled={busy||!answer||!reason.trim()}>{label}</button></form>;
}
function ActivityView({activity:a}:{activity:Activity}){
 return <section className="learning-activity"><h3>{a.title}</h3><p>{a.instruction}</p>
  {a.kind==='fraction_strips'&&a.denominators?.map(n=><div key={n}><p>같은 전체의 1/{n}</p><div className="fraction-strip" aria-label={`같은 길이를 ${n}등분한 첫 조각`}>
   {Array.from({length:Math.min(20,n)},(_,i)=><span key={i} className={i===0?'filled':''}>{i===0?`1/${n}`:''}</span>)}</div></div>)}
  {a.kind==='comparison'&&a.cases?.map(c=><p key={c.label}><strong>{c.label}</strong> · {c.value}</p>)}
 </section>;
}
function AttemptPanel({row:r,teacher,act,busy}:{row:Attempt;teacher:boolean;act:Act;busy:boolean}){
 const [feedback,setFeedback]=useState(''),[activity,setActivity]=useState(r.activities?.[0]?.id??''),[observation,setObservation]=useState(''),[explanation,setExplanation]=useState('');
 const chosenActivity=r.activities?.some(a=>a.id===activity)?activity:r.activities?.[0]?.id??'';
 const run=(action:string,data:Record<string,unknown>)=>act(action,data,r.id,r.version);
 const pending=r.job&&['queued','running','retry_wait'].includes(r.job.status);
 return <article><h3>{r.title} · {stages[r.stage]}</h3><p>{r.prompt}</p><blockquote>{r.response.answer}<br/>{r.response.reason}</blockquote>
  {r.stage==='awaiting_review'&&<p role="status">{r.job?.error_code==='quota'?'AI 사용 한도에 도달해 다음 사용 가능 시각까지 대기합니다. 선생님이 직접 검토할 수 있어요.':r.job?.status==='failed'?'AI 분석에 실패했어요. 답안은 저장되어 있고 선생님이 직접 검토할 수 있어요.':pending?'AI 분석 대기 또는 처리 중입니다. 선생님이 먼저 검토할 수도 있어요.':'선생님의 확인을 기다리고 있어요.'}</p>}
  {teacher&&r.analysis&&<section className="learning-activity"><h4>AI 제안 · {interpretations[r.analysis.interpretation]}</h4><p>{r.analysis.note}</p><blockquote>{r.analysis.quote||'인용할 근거 부족'}</blockquote>
   <p>다음 단계 제안: {proposalLabels[r.analysis.proposal?.kind]||'교사 확인'}</p><small>모델 {r.analysis.model} · 프롬프트 {r.analysis.promptVersion}</small></section>}
  {r.teacher_feedback&&<p><strong>선생님 피드백</strong> · {r.teacher_feedback}</p>}
  {teacher&&r.stage==='awaiting_review'&&<section><label>검토 의견 / 학생에게 보낼 질문<textarea required disabled={busy} value={feedback} maxLength={2000} onChange={e=>setFeedback(e.target.value)}/></label>
   <label>확인 활동<select value={chosenActivity} disabled={busy||!r.activities?.length} onChange={e=>setActivity(e.target.value)}>{r.activities?.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label>
   <div className="learning-toolbar"><button disabled={busy||!feedback.trim()} onClick={()=>void run('request_clarification',{feedback})}>이유 더 묻기</button>
    <button disabled={busy||!feedback.trim()||!chosenActivity} onClick={()=>void run('assign_activity',{feedback,activity_id:chosenActivity})}>활동 배정</button>
    <button disabled={busy||!feedback.trim()} onClick={()=>void run('confirm_understanding',{feedback})}>이해 확인 · 새 문항으로</button></div></section>}
  {!teacher&&r.stage==='needs_clarification'&&<AnswerForm item={r} busy={busy} label="이유 보완해서 보내기" onSend={d=>run('resubmit',d)}/>}
  {r.activity&&<ActivityView activity={r.activity}/>}
  {!teacher&&r.stage==='activity_assigned'&&<form onSubmit={e=>{e.preventDefault();void run('complete_activity',{observation,explanation});}}>
   <label>활동에서 확인한 내용<textarea required disabled={busy} maxLength={2000} value={observation} onChange={e=>setObservation(e.target.value)}/></label>
   <label>다시 설명한 내 생각<textarea required disabled={busy} maxLength={2000} value={explanation} onChange={e=>setExplanation(e.target.value)}/></label>
   <button disabled={busy||!observation.trim()||!explanation.trim()}>활동 기록 저장</button></form>}
  {r.activity_response&&<p>관찰: {r.activity_response.observation}<br/>바뀐 설명: {r.activity_response.explanation}</p>}
  {!teacher&&r.stage==='awaiting_transfer'&&r.transfer&&<AnswerForm item={r.transfer} busy={busy} label="새 문항 답안 보내기" onSend={d=>run('submit_transfer',d)}/>}
  {r.transfer_response&&<section><h4>새 문항에서의 설명</h4><p>{r.transfer?.prompt}</p><blockquote>{r.transfer_response.answer}<br/>{r.transfer_response.reason}</blockquote></section>}
  {teacher&&r.stage==='awaiting_final_review'&&<form onSubmit={e=>{e.preventDefault();void run('complete',{feedback});}}><label>재확인 의견<textarea required disabled={busy} value={feedback} maxLength={2000} onChange={e=>setFeedback(e.target.value)}/></label><button disabled={busy||!feedback.trim()}>검토 완료</button></form>}
  <LearningResources row={r} teacher={teacher} act={act} busy={busy}/>
  {r.final_feedback&&<p><strong>교사 최종 확인</strong> · {r.final_feedback}</p>}
 </article>;
}
