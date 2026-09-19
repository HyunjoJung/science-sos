'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createLatestRequest, createMutationClient, getJson } from '@/lib/runtime/client.mjs';
import '@/app/learn/learning.css';
type Activity={id:string;kind:string;title:string;instruction:string};
type Spec={prompt:string;choices:string[];activities:Activity[];transfer?:{prompt:string;choices:string[]};rubric:string[]};
type Pack={id:string;version:string;subject:string;title:string;scope:string;spec:Spec;key?:{answer:string;transfer_answer:string;rubric:string[]}};
type Job={id:string;status:string;error_code?:string;next_at?:string};
type Attempt={id:string;version:number;student_id:string;assignment_id:string;created_at:string;alias:string;stage:string;choice:string;reason:string;analysis?:{interpretation:string;note:string;evidence:string;recommendation:string};teacher_note?:string;activity_id?:string;observation?:string;revised_text?:string;transfer_choice?:string;transfer_reason?:string;scores?:number[];job?:Job;pack:{title:string;subject:string;scope:string;spec:Spec}};
type Course={id:string;title:string;role:string;alias:string};
type Assignment={id:string;title:string;subject:string;scope:string;spec:Spec;attempt_id?:string};
type Snapshot={user_id:string|null;courses:Course[];role?:string;attempts?:Attempt[];has_more?:boolean;packs?:Pack[];assignments?:Assignment[];worker_online?:boolean;materials?:{id:string;title:string;version:number;enabled:boolean}[];chats?:{id:string;question:string;answer?:string;created_at:string;sources?:{quote:string;material_id:string}[];job?:Job}[];members?:{user_id:string;alias:string;role:string;active:boolean}[]};
type Send=(action:string,data:Record<string,unknown>,id?:string|null,version?:number|null)=>Promise<boolean>;
const stages:Record<string,string>={awaiting_review:'교사 검토 대기',needs_clarification:'설명 보완',activity_assigned:'확인 활동',awaiting_transfer:'새 사례 확인',awaiting_final_review:'최종 검토 대기',completed:'완료'};
const jobs:Record<string,string>={queued:'분석 대기',running:'분석 중',retry_wait:'연결 복구 후 재시도',budget_wait:'일일 예산 대기',succeeded:'분석 완료',failed:'분석 실패 · 교사 직접 검토',cancelled:'이전 분석 취소'};
const empty:Snapshot={user_id:null,courses:[]};
const errorText=(e:unknown)=>e instanceof Error?e.message:'요청을 처리하지 못했어요.';
export default function LearningWorkspace(){
 const [snapshot,setSnapshot]=useState<Snapshot>(empty),[course,setCourse]=useState(''),[cursor,setCursor]=useState<{at:string;id:string}|null>(null),[selected,setSelected]=useState<Attempt|null>(null);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[invite,setInvite]=useState('');
 const latest=useRef(createLatestRequest()),lock=useRef(false),mounted=useRef(true),account=useRef<string|null>(null);
 const client=useRef(createMutationClient({storage:()=>typeof window==='undefined'?null:sessionStorage}));
 const refresh=useCallback(async():Promise<Snapshot|null>=>{
  const pending=latest.current.begin();
  try{
   const params=new URLSearchParams();if(course)params.set('course',course);if(cursor){params.set('before',cursor.at);params.set('before_id',cursor.id);}
   const data=await getJson('/api/learning?'+params,pending.signal) as Snapshot;
   if(!pending.isCurrent()||!mounted.current)return null;
   if(!data||!Array.isArray(data.courses)||!('user_id'in data))throw Error('수업 응답을 확인하지 못했어요.');
   if(account.current!==data.user_id){setSelected(null);setInvite('');account.current=data.user_id;}
   setSnapshot(data);
   return data;
  }catch(e){if(pending.isCurrent()&&mounted.current){setError(errorText(e));if([401,403].includes((e as {status?:number}).status||0)){setSnapshot(empty);setInvite('');setCourse('');setCursor(null);setSelected(null);}}return null;}
  finally{if(pending.isCurrent()&&mounted.current)setLoading(false);}
 },[course,cursor]);
 useEffect(()=>{
  mounted.current=true;let active=true,timer:ReturnType<typeof setTimeout>;
  const tick=async()=>{if(!lock.current&&!document.hidden)await refresh();if(active)timer=setTimeout(tick,5000);};
  void tick();return()=>{active=false;mounted.current=false;clearTimeout(timer);latest.current.cancel();};
 },[refresh]);
 async function auth(action:'login'|'logout',data:Record<string,unknown>){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');latest.current.cancel();setSelected(null);setInvite('');
  if(action==='logout'){setSnapshot(empty);setCourse('');setCursor(null);}
  try{await client.current.send('guest','/api/lab',action,data);await refresh();}
  catch(e){setError(errorText(e));}finally{lock.current=false;setBusy(false);}
 }
 const send:Send=async(action,data,id=null,version=null)=>{
  if(lock.current)return false;lock.current=true;setBusy(true);setError('');setNotice('');latest.current.cancel();
  try{
   const result=await client.current.send(snapshot.user_id||'guest','/api/learning',action,{...data,course_id:course||null},id,version);
   if(action==='invite')setInvite((result as {token?:string}).token||'');
   if(action==='create_course'||action==='join_course'){setCourse(result.id||'');setCursor(null);setSelected(null);setSnapshot(s=>({user_id:s.user_id,courses:s.courses}));setNotice('수업을 저장했어요.');return true;}
   const fresh=await refresh();
   if(action!=='invite'){setSelected(fresh?.attempts?.find(a=>a.id===result.id)||null);}
   setNotice(fresh?'저장했어요.':'저장은 완료됐어요. 최신 화면 조회는 다시 시도해 주세요.');return true;
  }catch(e){setError(errorText(e));return false;}
  finally{lock.current=false;setBusy(false);}
 };
 const teacher=snapshot.role==='teacher',rows=snapshot.attempts||[],current=snapshot.courses.find(c=>c.id===course);
 const selectedFresh=selected?rows.find(r=>r.id===selected.id):undefined;
 return <div className="learning-shell">
  <header className="learning-header"><div><a href="/learn" className="learning-brand">학습SOS</a><p>근거를 확인하고, 설명의 변화를 함께 살펴요.</p></div><a href="/">기존 과학 교실</a>{snapshot.user_id&&<button disabled={busy} onClick={()=>void auth('logout',{})}>로그아웃</button>}</header>
  <main>
   <h1>우리의 생각을 잇는 교실</h1>
   {error&&<div className="learning-alert" role="alert">{error} <button onClick={()=>{setError('');void refresh();}} disabled={busy}>다시 확인</button></div>}
   {notice&&<p role="status" className="learning-notice">{notice}</p>}
   {loading?<p role="status">수업을 불러오고 있어요.</p>:!snapshot.user_id?<section className="learning-card"><h2>수업에 로그인</h2><p>배정된 교사·학생 계정을 사용하세요. 이 화면에는 실제 AI 처리만 표시합니다.</p>
    <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void auth('login',{email:f.get('email'),password:f.get('password')});}}><label>이메일<input name="email" type="email" autoComplete="username" required/></label><label>비밀번호<input name="password" type="password" autoComplete="current-password" required/></label><button disabled={busy}>로그인</button></form></section>:
    <div key={snapshot.user_id}>
     <section className="learning-toolbar"><label>수업 선택<select value={course} disabled={busy} onChange={e=>{latest.current.cancel();setCourse(e.target.value);setCursor(null);setSelected(null);setInvite('');setSnapshot(s=>({user_id:s.user_id,courses:s.courses}));}}><option value="">수업을 선택하세요</option>{snapshot.courses.map(c=><option key={c.id} value={c.id}>{c.title} · {c.role==='teacher'?'교사':'학생'}</option>)}</select></label>{current&&<p>{current.alias} · {current.role==='teacher'?'교사 화면':'학생 화면'}</p>}</section>
     {!course&&<section className="learning-card"><h2>초대받은 수업 참가</h2><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('join_course',{token:f.get('token'),alias:f.get('alias')});}}><label>참여 코드<input name="token" required minLength={32} maxLength={80} autoComplete="off"/></label><label>수업에서 사용할 이름<input name="alias" required maxLength={80}/></label><button disabled={busy}>학생으로 참가</button></form></section>}
     {course&&snapshot.role&&<>
      <p className="learning-status" role="status">{snapshot.worker_online?'AI 처리 서버 연결됨':'AI 처리 서버의 최근 연결이 확인되지 않아요. 답안 저장과 교사 직접 검토는 가능합니다.'}</p>
      {teacher&&<details className="learning-card"><summary>수업 관리와 콘텐츠 검토</summary><p>예제 팩은 공식 교육과정 검증이나 학습 효과 검증을 마친 자료가 아닙니다. 수업 범위·정답·활동을 확인한 뒤 배정하세요.</p>
       <div className="learning-grid">{(snapshot.packs||[]).map(p=><section className="learning-card" key={p.id}><span className="learning-tag">{p.subject} · v{p.version}</span><h3>{p.title}</h3><p>{p.scope}</p><p>{p.spec.prompt}</p><p><b>정답 기준:</b> {p.key?.answer}</p><p><b>전이문항:</b> {p.spec.transfer?.prompt}</p><p><b>전이 정답:</b> {p.key?.transfer_answer}</p>{p.spec.activities.map(a=><p key={a.id}><b>{a.title}</b> — {a.instruction}</p>)}<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('publish_assignment',{pack_id:p.id,pack_version:p.version,reviewed:true,review_note:f.get('note')});}}><label>검토 기록<textarea name="note" required minLength={5} maxLength={1000} placeholder="확인한 수업 범위와 유의점을 기록하세요."/></label><label className="learning-check"><input type="checkbox" required/>문항·정답·활동을 검토했어요.</label><button disabled={busy}>검토하고 수업에 배정</button></form></section>)}</div>
       <h3>학생 초대</h3><button disabled={busy} onClick={()=>void send('invite',{})}>24시간 참여 코드 발급 · 이전 코드 무효화</button>{invite&&<label>참여 코드<input readOnly value={invite} onFocus={e=>e.target.select()}/></label>}
       <h3>등록 학생</h3>{(snapshot.members||[]).filter(m=>m.role==='student').map(m=><p key={m.user_id}>{m.alias} · {m.active?'참여 중':'접근 해제됨'} {m.active&&<button disabled={busy} onClick={()=>{if(window.confirm(`${m.alias} 학생의 이 수업 접근을 해제할까요? 기존 기록은 교사에게 보존됩니다.`))void send('remove_student',{},m.user_id);}}>접근 해제</button>}</p>)}
       <h3>추가 수업 만들기</h3><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('create_course',{title:f.get('title')});}}><label>수업 이름<input name="title" required maxLength={120}/></label><button disabled={busy}>수업 생성</button></form>
      </details>}
      {!teacher&&<section><h2>배정된 활동</h2>{!(snapshot.assignments||[]).length&&<p>선생님이 자료를 검토하고 배정하면 여기에 나타납니다.</p>}<div className="learning-grid">{(snapshot.assignments||[]).map(a=><section className="learning-card" key={a.id}><span className="learning-tag">{a.subject}</span><h3>{a.title}</h3>{a.attempt_id?<p>제출한 활동입니다. 아래 학습 기록에서 이어가세요.</p>:<AnswerForm prompt={a.spec.prompt} choices={a.spec.choices} busy={busy} submit={(data)=>send('submit',data,a.id)}/>}</section>)}</div></section>}
      <section><h2>{teacher?'학생 설명 검토':'내 학습 기록'}</h2><div className="learning-records">{rows.map(r=><button disabled={busy} className={selected?.id===r.id?'selected':''} key={r.id} onClick={()=>setSelected(r)}><strong>{r.alias} · {r.pack.subject}</strong><span>{stages[r.stage]}</span><small>{r.job?jobs[r.job.status]:''}</small></button>)}</div>{!rows.length&&<p>아직 제출된 기록이 없어요.</p>}
       <div className="learning-buttons">{cursor&&<button disabled={busy} onClick={()=>{setCursor(null);setSelected(null);}}>최신 기록</button>}{snapshot.has_more&&rows.length>0&&<button disabled={busy} onClick={()=>{const last=rows[rows.length-1];setCursor({at:last.created_at,id:last.id});setSelected(null);}}>이전 기록 50개</button>}</div>
       {selected&&<AttemptPanel key={selected.id+':'+selected.version} r={selected} teacher={teacher} busy={busy} stale={!!selectedFresh&&selectedFresh.version!==selected.version} latest={selectedFresh} reopen={()=>selectedFresh&&setSelected(selectedFresh)} send={send}/>}
      </section>
      <section className="learning-card"><h2>수업 근거 자료</h2><p>등록된 본문에서 근거를 찾습니다. 임의의 인터넷 검색은 하지 않습니다.</p>{(snapshot.materials||[]).map(m=><p key={m.id}>{m.title} · v{m.version} · {m.enabled?'사용 중':'비공개'} {teacher&&<button disabled={busy} onClick={()=>void send('material_edit',{enabled:!m.enabled},m.id,m.version)}>{m.enabled?'비공개로 전환':'다시 사용'}</button>}</p>)}
       {teacher&&<form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);if(await send('material_add',{title:f.get('title'),content:f.get('content')}))form.reset();}}><label>자료 제목<input name="title" required maxLength={120}/></label><label>검토한 자료 본문<textarea name="content" required maxLength={30000} placeholder="TXT·MD 본문을 붙여 넣으세요. PDF 자동 추출을 지원한다고 표시하지 않습니다."/></label><button disabled={busy}>자료 등록</button></form>}
      </section>
      <section className="learning-card"><h2>근거로 질문하기</h2><p>최근 질문 20개를 표시합니다. 담당 교사가 수업 질문을 검토할 수 있어요. 근거가 부족하면 답변을 보류합니다.</p>
       {(snapshot.chats||[]).map(c=><article key={c.id} className="learning-chat"><strong>{c.question}</strong><p>{c.answer||(c.job?jobs[c.job.status]:'처리 대기')}</p>{c.sources?.map((s,i)=><blockquote key={i}>{s.quote}</blockquote>)}{teacher&&c.job?.status==='failed'&&<button disabled={busy} onClick={()=>void send('retry_job',{},c.job!.id)}>재시도</button>}</article>)}
       {!teacher&&<form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);if(await send('chat_send',{question:f.get('question')}))form.reset();}}><label>수업 질문<textarea name="question" required maxLength={500}/></label><button disabled={busy}>질문 보내기</button></form>}
      </section>
     </>}
    </div>}
  </main><footer>AI는 가설과 근거를 제안합니다. 활동 배정과 최종 확인은 교사가 결정합니다.</footer>
 </div>;
}
function AnswerForm({prompt,choices,busy,submit}:{prompt:string;choices:string[];busy:boolean;submit:(data:Record<string,unknown>)=>Promise<boolean>}){
 const [reason,setReason]=useState('');return <form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await submit({choice:f.get('choice'),reason});}}><p>{prompt}</p><fieldset disabled={busy}><legend>내 생각과 이유</legend>{choices.map(c=><label className="learning-check" key={c}><input type="radio" required name="choice" value={c}/>{c}</label>)}<label>이유<textarea required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button>설명 보내기</button></fieldset></form>;
}
function AttemptPanel({r,teacher,busy,stale,latest,reopen,send}:{r:Attempt;teacher:boolean;busy:boolean;stale:boolean;latest?:Attempt;reopen:()=>void;send:Send}){
 const activity=r.pack.spec.activities.find(a=>a.id===r.activity_id),analysis=latest?.analysis||r.analysis,job=latest?.job||r.job;
 return <section className="learning-card"><h3>{r.alias}의 설명 · {r.pack.title}</h3><p className="learning-tag">{stages[r.stage]}</p>{stale&&<p role="alert">다른 화면에서 기록이 변경됐어요. 입력한 내용은 유지했습니다. <button onClick={reopen}>최신 기록으로 다시 열기</button></p>}
  <p><b>첫 선택</b> {r.choice}</p><blockquote>{r.reason}</blockquote>{r.teacher_note&&<p><b>선생님 메시지</b> {r.teacher_note}</p>}
  {teacher&&<aside className="learning-analysis"><h4>AI 제안 · 확정 진단 아님</h4><p>{job?jobs[job.status]:'대기 중'}</p>{analysis&&<><p>{analysis.note}</p><blockquote>{analysis.evidence}</blockquote><p>추천 경로: {analysis.recommendation}</p></>}{job?.status==='failed'&&<button disabled={busy} onClick={()=>void send('retry_job',{},job.id)}>같은 입력 다시 분석</button>}</aside>}
  {teacher&&r.stage==='awaiting_review'&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send(String(f.get('action')),{note:f.get('note'),activity_id:f.get('activity_id')},r.id,r.version);}}><fieldset disabled={busy||stale}><legend>교사가 다음 단계를 결정해 주세요</legend><label>검토 결과<select name="action"><option value="request_clarification">근거 부족 · 설명 다시 묻기</option><option value="confirm_understanding">개념 이해 확인 · 새 사례로 이동</option><option value="assign_activity">확인 활동 배정</option></select></label><label>배정할 활동<select name="activity_id">{r.pack.spec.activities.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label><label>학생에게 보낼 메시지<textarea name="note" required maxLength={1000}/></label><button>검토 결과 저장</button></fieldset></form>}
  {!teacher&&r.stage==='needs_clarification'&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('resubmit',{reason:f.get('reason')},r.id,r.version);}}><label>설명을 더해 주세요<textarea name="reason" required maxLength={1000} defaultValue={r.reason}/></label><button disabled={busy||stale}>설명 보완해서 보내기</button></form>}
  {!teacher&&r.stage==='activity_assigned'&&activity&&<><ActivityView activity={activity}/><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('complete_activity',{observation:f.get('observation'),revised_text:f.get('revised_text')},r.id,r.version);}}><label>직접 확인한 내용<textarea required name="observation" maxLength={1000}/></label><label>이제 어떻게 설명하나요?<textarea required name="revised_text" maxLength={1000}/></label><button disabled={busy||stale}>활동과 수정 설명 저장</button></form></>}
  {r.observation&&<p><b>확인한 근거</b> {r.observation}</p>}{r.revised_text&&<p><b>수정한 설명</b> {r.revised_text}</p>}
  {!teacher&&r.stage==='awaiting_transfer'&&r.pack.spec.transfer&&<AnswerForm prompt={r.pack.spec.transfer.prompt} choices={r.pack.spec.transfer.choices} busy={busy||stale} submit={d=>send('submit_transfer',d,r.id,r.version)}/>}
  {r.transfer_choice&&<><p><b>새 사례 선택</b> {r.transfer_choice}</p><blockquote>{r.transfer_reason}</blockquote></>}
  {teacher&&r.stage==='awaiting_final_review'&&<form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await send('complete',{scores:[0,1,2].map(i=>Number(f.get('score'+i))),note:f.get('note')},r.id,r.version);}}><fieldset disabled={busy||stale}><legend>교사 최종 확인 · 0 근거 없음 / 1 일부 / 2 충분함</legend>{r.pack.spec.rubric.map((label,i)=><label key={label}>{label}<select name={'score'+i} required defaultValue=""><option value="" disabled>선택</option>{[0,1,2].map(n=><option key={n} value={n}>{n}</option>)}</select></label>)}<label>최종 피드백<textarea required name="note" maxLength={1000}/></label><button>검토 완료</button></fieldset></form>}
  {r.scores&&<p>교사 확인 결과: {r.scores.map((s,i)=>`${r.pack.spec.rubric[i]} ${s}/2`).join(' · ')}</p>}
 </section>;
}
function ActivityView({activity}:{activity:Activity}){
 const [mass,setMass]=useState(80),[volume,setVolume]=useState(100),[left,setLeft]=useState(3),[right,setRight]=useState(5);
 return <div className="learning-activity"><h4>{activity.title}</h4><p>{activity.instruction}</p>{activity.kind==='density'?<><p>물의 밀도 1g/cm³와 비교하는 이상화 모형입니다. 실제 센서 관측값이 아닙니다.</p><label>질량 {mass}g<input type="range" min="20" max="160" value={mass} onChange={e=>setMass(Number(e.target.value))}/></label><label>부피 {volume}cm³<input type="range" min="20" max="200" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label><output aria-live="polite">밀도 {(mass/volume).toFixed(2)} g/cm³ — {mass<volume?'물보다 밀도가 작아 떠요':mass>volume?'물보다 밀도가 커 가라앉아요':'밀도가 같아요. 이상화한 조건에서 중성 부력이에요'}</output></>:activity.kind==='number_line'?<>{[[left,setLeft],[right,setRight]].map(([n,update],i)=><div key={i}><label>막대 {i+1} 분모 {n as number}<input type="range" min="2" max="10" value={n as number} onChange={e=>(update as (n:number)=>void)(Number(e.target.value))}/></label><div className="learning-whole" aria-label={`같은 전체에서 1/${n as number}`}><span style={{width:`${100/(n as number)}%`}}/></div><output>1/{n as number}</output></div>)}</>:<blockquote>“응답한 학생 40명 중 30명”과 “모든 학생”은 같은 범위인가요? 문장에 없는 범위를 덧붙이지 않고 근거를 적어 보세요.</blockquote>}</div>;
}
