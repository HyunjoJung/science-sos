'use client';
import {useId,useState} from 'react';
import {getResource} from '@/lib/mcp/catalog.mjs';
export type LearningResource={id:string;version:string;url:string;title:string;provider:string;kind:string;language:string;summary:string;notice:string;checkedAt:string;recommended?:boolean};
type ResourceRow={id:string;version:number;resource_revision?:number;resource_candidates?:LearningResource[];shared_resources?:LearningResource[];analysis?:{resourceLookup?:{transport:string;status:string;catalogVersion:string}}};
type Act=(action:string,data:Record<string,unknown>,id:string,version?:number)=>Promise<boolean>;
function safeUrl(r:LearningResource){try{const trusted=getResource(r.id).resource;return trusted.version===r.version&&trusted.url===r.url?r.url:null;}catch{return null;}}
function ResourceLink({resource:r}:{resource:LearningResource}){
 const href=safeUrl(r);
 return href?<a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{r.title} · 외부 사이트 열기 ↗</a>:<span>현재 배포에서 확인하지 못한 자료입니다.</span>;
}
function ReviewCard({r,shared,busy,share,revoke}:{r:LearningResource;shared:boolean;busy:boolean;share:()=>Promise<boolean>;revoke:()=>Promise<boolean>}){
 const [reviewed,setReviewed]=useState(false);const checkId=useId();
 return <section className="learning-resource-card" data-testid={'resource-'+r.id}>
  <h5><ResourceLink resource={r}/></h5><p>{r.provider} · {r.language} · {r.kind==='portal'?'자료 탐색 포털':'학습 자료'}</p>
  <p>{r.summary}</p><small>링크 확인일 {r.checkedAt} · v{r.version}{r.recommended?' · 주제 기반 도구 후보':''}</small><p>{r.notice}</p>
  {shared?<><p role="status">학생에게 전달됨</p><button disabled={busy} onClick={()=>void revoke()}>자료 전달 철회</button></>:<>
   <label className="learning-check" htmlFor={checkId}><input id={checkId} type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>현재 링크와 수업 적합성을 확인했습니다.</label>
   <button disabled={busy||!reviewed||!safeUrl(r)} onClick={async()=>{if(await share())setReviewed(false);}}>학생에게 자료 전달</button>
  </>}
 </section>;
}
export default function LearningResources({row,teacher,act,busy}:{row:ResourceRow;teacher:boolean;act:Act;busy:boolean}){
 const shared=row.shared_resources??[];const lookup=row.analysis?.resourceLookup;
 const send=(action:string,r:LearningResource)=>act(action,{resource_id:r.id,resource_version:r.version,reviewed:true,attempt_version:row.version},row.id,row.resource_revision);
 return <section className="learning-resource-panel" aria-label="교사 확인 학습자료">
  <h4>{teacher?'학습자료 후보 검토':'선생님이 전달한 학습자료'}</h4>
  {teacher?<>
   <p>공식 링크 디렉터리의 참고 후보입니다. 채점 근거나 자동 처방이 아닙니다. 원문과 접근 조건을 확인한 뒤 전달하세요.</p>
   {lookup&&<p className="learning-tool-trace" role="status">{lookup.transport==='mcp'?'MCP':'로컬'} 자료 조회 · {lookup.status==='ok'?'완료':lookup.status==='unsupported'?'지원 주제 없음':'자료 연결 미완료'} · 목록 {lookup.catalogVersion}</p>}
   {(row.resource_candidates??[]).map(r=>{const isShared=shared.some(s=>s.id===r.id&&s.version===r.version);return <ReviewCard key={JSON.stringify([row.id,r.id,r.version,isShared])} r={r} busy={busy} shared={isShared} share={()=>send('share_resource',r)} revoke={()=>send('revoke_resource',r)}/>;})}
   {!row.resource_candidates?.length&&<p>이 수업에 검토할 공개 자료 후보가 없습니다.</p>}
  </>:shared.length?shared.map(r=><div className="learning-resource-card" key={r.id+r.version}><ResourceLink resource={r}/><p>{r.summary}</p><small>{r.notice}</small></div>):<p>아직 선생님이 전달한 자료가 없어요.</p>}
 </section>;
}
