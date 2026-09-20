import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,users,sql,act,list,claim,finish,packs,asUser} from './fixtures.mjs';
function setup(){
 const {c1}=fixture();const pack=packs[0];
 const assignment=act(users.teacher,'activate_pack',c1,null,{pack_id:pack.id,pack_version:pack.version,reviewed:true});
 const id=act(users.student,'submit',assignment,null,{answer:pack.correctAnswer,reason:'보존되어야 할 합성 답안'});
 return {c1,id,job:claim()};
}
for(const code of ['provider_credit','provider_auth','provider_policy','provider_request','invalid_evidence'])
 test(`${code} cannot be auto-retried even if worker requests retry`,()=>{
  const {c1,job}=setup();assert.equal(finish(job,null,code,true),'t');
  const r=list(users.teacher,c1).attempts[0];assert.equal(r.job.status,'failed');assert.equal(r.job.error_code,code);
  assert.equal(r.stage,'awaiting_review');assert.equal(r.response.reason,'보존되어야 할 합성 답안');assert.equal(r.analysis,null);
  assert.equal(claim(),null);assert.equal(sql(`select count(*) from private.learning_events where action='analysis_completed'`),'0');
 });
test('Gateway failure does not block teacher from finishing review',()=>{
 const {c1,id,job}=setup();finish(job,null,'provider_credit',false);
 act(users.teacher,'confirm_understanding',id,1,{feedback:'원문을 직접 확인했습니다.'});
 assert.equal(list(users.student,c1).attempts[0].stage,'awaiting_transfer');
});
test('gateway provenance persists once and is not exposed in student analysis',()=>{
 const {c1,job}=setup();const value={interpretation:'understood',evidence:'supported',quote:job.response.reason,
  note:'합성 확인',ruleVerdict:'correct',model:'gpt-oss-120b',requestedModel:'openai/gpt-oss-120b',
  gateway:{provider:'vercel-ai-gateway',requestedPrivacy:'zdr',outputFormat:'json_schema'},usage:{total_tokens:20}};
 assert.equal(finish(job,value),'t');assert.equal(finish(job,value),'f');
 assert.deepEqual(list(users.teacher,c1).attempts[0].analysis.gateway,value.gateway);
 assert.equal('analysis' in list(users.student,c1).attempts[0],false);
});
test('new finish implementation remains inaccessible to students',()=>{
 const {job}=setup();assert.throws(()=>asUser(users.student,`select public.learning_finish('${job.id}','${job.lease}',null,'provider_credit',false)`));
});
