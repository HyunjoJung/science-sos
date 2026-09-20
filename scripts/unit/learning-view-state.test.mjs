import test from 'node:test';
import assert from 'node:assert/strict';
import {attemptDraftKey, reconcileAttemptSelection} from '../../src/lib/learning/view-state.mjs';

const context={user_id:'teacher-1',course_id:'science-1',role:'teacher'};
const attempt={id:'attempt-1',stage:'awaiting_review',version:1,response:{answer:'나무',reason:'더 가벼워서'}};

test('AI completion and resource delivery preserve an unfinished teacher draft',()=>{
 const refreshed={...attempt,version:3,analysis:{interpretation:'misconception'},resource_revision:2,shared_resources:[{id:'resource-1'}]};
 assert.equal(attemptDraftKey(context,attempt),attemptDraftKey(context,refreshed));
});

for(const [field,value] of [['user_id','teacher-2'],['course_id','science-2'],['role','student']]){
 test(`a changed ${field} cannot inherit another review draft`,()=>{
  assert.notEqual(attemptDraftKey(context,attempt),attemptDraftKey({...context,[field]:value},attempt));
 });
}

test('changing record, stage or the student explanation starts a fresh review',()=>{
 for(const change of [{id:'attempt-2'},{stage:'awaiting_final_review'},{response:{...attempt.response,reason:'밀도를 비교해서'}}]){
  assert.notEqual(attemptDraftKey(context,attempt),attemptDraftKey(context,{...attempt,...change}));
 }
});

test('activity and transfer drafts survive metadata refresh but rebase on changed instructions',()=>{
 for(const [stage,field,content,changed] of [
  ['activity_assigned','activity',{id:'a',instruction:'나무와 철을 비교해요'},{id:'a',instruction:'물과 기름을 비교해요'}],
  ['awaiting_transfer','transfer',{prompt:'기름에서는?',choices:['뜬다','가라앉는다']},{prompt:'소금물에서는?',choices:['뜬다','가라앉는다']}],
  ['needs_clarification','teacher_feedback','어떤 조건을 보았나요?','물체와 액체를 비교해 볼까요?'],
  ['awaiting_final_review','transfer_response',{answer:'뜬다',reason:'물보다 밀도가 작아서'},{answer:'가라앉는다',reason:'물보다 밀도가 커서'}],
 ]){
  const initial={...attempt,stage,[field]:content};
  assert.equal(attemptDraftKey(context,initial),attemptDraftKey(context,{...initial,version:20}));
  assert.notEqual(attemptDraftKey(context,initial),attemptDraftKey(context,{...initial,[field]:changed}));
 }
});

test('an explicit new submission id wins over the previously selected older record',()=>{
 const attempts=[{id:'newest-other-record'},{id:'just-submitted'},{id:'older'}];
 assert.equal(reconcileAttemptSelection(attempts,'just-submitted'),'just-submitted');
 assert.equal(reconcileAttemptSelection(attempts,'older'),'older');
});

test('record pagination or revoked access cannot retain a missing selection',()=>{
 assert.equal(reconcileAttemptSelection([{id:'previous-page'}],'older'),'previous-page');
 assert.equal(reconcileAttemptSelection([],'older'),'');
});
