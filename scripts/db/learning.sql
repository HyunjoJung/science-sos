\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(v boolean,msg text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAILED: %',msg;end if;raise notice 'PASS: %',msg;end$$;
create function pg_temp.reject(q text,expected text) returns void language plpgsql as $$declare did_fail boolean:=false;begin
 begin execute q;exception when others then if position(expected in sqlerrm)=0 then raise exception 'Wrong error: %, expected %',sqlerrm,expected;end if;did_fail:=true;end;
 if not did_fail then raise exception 'FAILED: query unexpectedly accepted';end if;raise notice 'PASS: rejected %',expected;
end$$;
select id as ca from public.learning_courses where legacy_class='qa-a' \gset
select id as cb from public.learning_courses where legacy_class='qa-b' \gset
select pg_temp.ok(not has_function_privilege('anon','public.learning_snapshot(uuid,timestamptz,uuid)','EXECUTE'),'anonymous RPC denied');
select pg_temp.ok(not has_function_privilege('authenticated','public.learning_job_claim()','EXECUTE'),'student/teacher cannot claim jobs');
select pg_temp.ok(not has_function_privilege('authenticated','private.lab_act_v1_impl(text,uuid,integer,jsonb,uuid)','EXECUTE'),'legacy implementation cannot bypass its wrapper');
set local role authenticated;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select pg_temp.reject('select public.lab_act(''submit'',null,null,''{"item":"D01","prediction":"not a real choice","reason":"검증"}'',gen_random_uuid())','invalid_input');
select public.lab_act('submit',null,null,'{"item":"D01","prediction":"나무는 뜨고 철은 가라앉아요","reason":"밀도를 비교했습니다."}',gen_random_uuid()) as legacy_attempt \gset
reset role;
select pg_temp.ok(exists(select 1 from public.lab_records where id=:'legacy_attempt'),'legacy API remains usable');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select pg_temp.ok(jsonb_array_length(public.learning_snapshot(:'ca')->'packs')=3,'teacher sees three reviewable packs');
select pg_temp.reject(format('select public.learning_snapshot(%L)',:'cb'),'forbidden');
select pg_temp.reject(format('select public.learning_command(''publish_assignment'',%L,null,null,''{"pack_id":"science-density","pack_version":"1.0.0","reviewed":false,"review_note":"검토 기록입니다"}'',gen_random_uuid())',:'ca'),'invalid_input');
select public.learning_command('publish_assignment',:'ca',null,null,'{"pack_id":"science-density","pack_version":"1.0.0","reviewed":true,"review_note":"수업 범위와 정답을 확인했습니다"}',gen_random_uuid()) as science \gset
select public.learning_command('publish_assignment',:'ca',null,null,'{"pack_id":"math-fractions","pack_version":"1.0.0","reviewed":true,"review_note":"분수 예제의 기준을 확인했습니다"}',gen_random_uuid()) as maths \gset
select public.learning_command('publish_assignment',:'ca',null,null,'{"pack_id":"reading-evidence","pack_version":"1.0.0","reviewed":true,"review_note":"창작 지문의 범위를 확인했습니다"}',gen_random_uuid()) as reading \gset
select gen_random_uuid() as invite_request \gset
select public.learning_invite(:'ca',:'invite_request')->>'token' as invite \gset
select pg_temp.ok((public.learning_invite(:'ca',:'invite_request')->>'token')=:'invite','invite issuance is retry-safe');
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select pg_temp.ok(jsonb_array_length(public.learning_snapshot(:'ca')->'assignments'->0->'spec'->'activities')=0,'unassigned activities are not disclosed');
select pg_temp.ok(public.learning_snapshot(:'ca')->'packs'='[]','student does not receive answer keys');
select pg_temp.reject('select * from public.learning_attempts','permission denied');
select pg_temp.reject(format('select public.learning_snapshot(%L)',:'cb'),'forbidden');
select pg_temp.reject(format('select public.learning_command(''publish_assignment'',%L,null,null,''{}'',gen_random_uuid())',:'ca'),'forbidden');
select pg_temp.reject(format('select public.learning_command(''submit'',%L,%L,null,''{"choice":"조작한 선택지","reason":"충분한 이유"}'',gen_random_uuid())',:'ca',:'science'),'invalid_input');
select gen_random_uuid() as submit_key \gset
select public.learning_command('submit',:'ca',:'science',null,'{"choice":"나무는 뜨고 철은 가라앉아요","reason":"나무의 밀도는 물보다 작고 철은 큽니다."}',:'submit_key') as attempt \gset
select pg_temp.ok(public.learning_command('submit',:'ca',:'science',null,'{"choice":"나무는 뜨고 철은 가라앉아요","reason":"나무의 밀도는 물보다 작고 철은 큽니다."}',:'submit_key')=:'attempt','lost ACK uses same request and result');
select pg_temp.reject(format('select public.learning_command(''submit'',%L,%L,null,''{"choice":"나무는 뜨고 철은 가라앉아요","reason":"변경된 이유"}'',%L)',:'ca',:'science',:'submit_key'),'idempotency_conflict');
select pg_temp.reject(format('select public.learning_command(''submit'',%L,%L,null,''{"choice":"나무는 뜨고 철은 가라앉아요","reason":"다시 만든 요청"}'',gen_random_uuid())',:'ca',:'science'),'version_conflict');
select pg_temp.ok(not ((public.learning_snapshot(:'ca')->'attempts'->0->'pack'->'spec')?'transfer'),'transfer question withheld before approval');
select pg_temp.reject(format('select public.learning_command(''confirm_understanding'',%L,%L,1,''{"note":"학생은 승인할 수 없다"}'',gen_random_uuid())',:'ca',:'attempt'),'forbidden_transition');
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select pg_temp.reject(format('select public.learning_command(''confirm_understanding'',%L,%L,null,''{"note":"버전 누락"}'',gen_random_uuid())',:'ca',:'attempt'),'version_conflict');
select public.learning_command('confirm_understanding',:'ca',:'attempt',1,'{"note":"설명이 타당하니 새 조건을 확인해 보세요."}',gen_random_uuid());
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select pg_temp.ok((public.learning_snapshot(:'ca')->'attempts'->0->>'stage')='awaiting_transfer','normal understanding skips corrective activity');
select public.learning_command('submit_transfer',:'ca',:'attempt',2,'{"choice":"A는 뜨고 B는 가라앉아요","reason":"A의 밀도는 0.6이고 B는 3입니다."}',gen_random_uuid());
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select pg_temp.reject(format('select public.learning_command(''complete'',%L,%L,3,''{"scores":[null,2,2],"note":"검토"}'',gen_random_uuid())',:'ca',:'attempt'),'invalid_input');
select public.learning_command('complete',:'ca',:'attempt',3,'{"scores":[2,2,2],"note":"조건과 근거를 연결했어요."}',gen_random_uuid());
select pg_temp.ok((public.learning_snapshot(:'ca')->'attempts'->0->>'stage')='completed','science full cycle complete');
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.learning_command('submit',:'ca',:'maths',null,'{"choice":"1/5이 더 커요","reason":"분모가 크기 때문입니다."}',gen_random_uuid()) as ma \gset
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.learning_command('request_clarification',:'ca',:'ma',1,'{"note":"같은 전체를 나누었을 때를 설명해 주세요."}',gen_random_uuid());
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.learning_command('resubmit',:'ca',:'ma',2,'{"reason":"같은 전체를 더 많이 나누면 한 조각이 더 크다고 생각했어요."}',gen_random_uuid());
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select pg_temp.reject(format('select public.learning_command(''assign_activity'',%L,%L,3,''{"activity_id":"density-compare","note":"다른 팩 활동"}'',gen_random_uuid())',:'ca',:'ma'),'invalid_input');
select public.learning_command('assign_activity',:'ca',:'ma',3,'{"activity_id":"fraction-line","note":"막대를 비교해 보세요."}',gen_random_uuid());
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.learning_command('complete_activity',:'ca',:'ma',4,'{"observation":"분모가 큰 막대의 한 조각이 더 작습니다.","revised_text":"같은 분자일 때 분모가 클수록 작습니다."}',gen_random_uuid());
select public.learning_command('submit_transfer',:'ca',:'ma',5,'{"choice":"2/3이 더 커요","reason":"같은 전체에서 더 큰 조각 두 개입니다."}',gen_random_uuid());
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.learning_command('complete',:'ca',:'ma',6,'{"scores":[2,2,2],"note":"수정한 원리를 새 사례에 적용했어요."}',gen_random_uuid());
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.learning_snapshot(:'ca')->'attempts') a where a->>'id'=:'ma' and a->>'stage'='completed'),'maths full cycle complete');
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.learning_command('submit',:'ca',:'reading',null,'{"choice":"도서관 운영 시간을 늘리기","reason":"운영 시간을 늘리자는 문장입니다."}',gen_random_uuid()) as ra \gset
reset role;
-- The actor role cannot bypass RLS by invoking the queue API; service-role invocation below is deliberate.
set local role service_role;
select public.learning_job_claim() as claimed \gset
select pg_temp.ok((:'claimed'::jsonb->>'kind')='analysis','queue claims current analysis');
select :'claimed'::jsonb->>'id' as job, :'claimed'::jsonb->>'lease' as lease \gset
select pg_temp.ok(public.learning_job_claim() is null,'leased job is not claimed twice');
select pg_temp.ok(not public.learning_job_finish(:'job',gen_random_uuid(),'{}','mock-model'),'wrong lease is fenced');
select pg_temp.ok(public.learning_job_heartbeat(:'job',:'lease'),'valid lease extends');
select pg_temp.ok(public.learning_job_finish(:'job',:'lease','{"interpretation":"understood","evidence":"운영 시간을 늘리자","note":"원문의 제안을 찾았습니다.","recommendation":"transfer_check"}','mock-model'),'analysis persisted');
select pg_temp.ok(public.learning_job_finish(:'job',:'lease','{"interpretation":"understood","evidence":"운영 시간을 늘리자","note":"원문의 제안을 찾았습니다.","recommendation":"transfer_check"}','mock-model'),'completion retry is idempotent');
reset role;
set local role authenticated;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.learning_snapshot(:'ca')->'attempts') a where a?'analysis'),'student never receives AI diagnosis payload');
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.learning_command('confirm_understanding',:'ca',:'ra',1,'{"note":"원문에 있는 주장을 정확히 확인했어요."}',gen_random_uuid());
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.learning_command('submit_transfer',:'ca',:'ra',2,'{"choice":"응답한 학생 중 35명이 그늘을 원한다","reason":"설문에 응답한 범위까지만 알 수 있습니다."}',gen_random_uuid());
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.learning_command('complete',:'ca',:'ra',3,'{"scores":[2,2,2],"note":"표본과 전체의 차이를 설명했어요."}',gen_random_uuid());
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.learning_snapshot(:'ca')->'attempts') a where a->>'id'=:'ra' and a->>'stage'='completed'),'reading full cycle complete');
select public.learning_command('material_add',:'ca',null,null,'{"title":"밀도 자료","content":"물의 밀도는 1이다. 나무의 밀도는 0.8이다."}',gen_random_uuid()) as material \gset
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.learning_command('chat_send',:'ca',null,null,'{"question":"물의 밀도는?"}',gen_random_uuid()) as chat \gset
reset role;
set local role service_role;
select public.learning_job_claim() as claimed \gset
select :'claimed'::jsonb->>'id' as job, :'claimed'::jsonb->>'lease' as lease \gset
select pg_temp.ok((:'claimed'::jsonb->'input'->'materials'->0->>'id')=:'material','chat gets only its course materials');
reset role;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.learning_command('material_edit',:'ca',:'material',1,'{"enabled":false}',gen_random_uuid());
reset role;
set local role service_role;
select pg_temp.ok(not public.learning_job_finish(:'job',:'lease',jsonb_build_object('answer','물의 밀도는 1입니다.','sources',jsonb_build_array(jsonb_build_object('material_id',:'material','version',1,'quote','물의 밀도는 1이다.'))),'mock-model'),'revocation during inference blocks publication');
reset role;
select pg_temp.ok((select status='failed' and error_code='source_changed' from private.learning_jobs where id=:'job'),'source-change failure is explicit, not infinite processing');
-- Exhausted budgets wait for a concrete UTC reset, not an endless spinner.
set local role authenticated;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.learning_command('chat_send',:'ca',null,null,'{"question":"다시 질문"}',gen_random_uuid()) as chat2 \gset
reset role;
update private.learning_global_limit set daily_calls=0;
set local role service_role;
select pg_temp.ok(public.learning_job_claim() is null,'global cap blocks additional model calls');
reset role;
select pg_temp.ok((select status='budget_wait' and error_code='global_daily_quota' from private.learning_jobs where target_id=:'chat2'),'global quota has an explicit wait state');
update private.learning_global_limit set daily_calls=100;
update private.learning_jobs set next_at=now() where target_id=:'chat2';
insert into private.learning_limits values(:'ca','chat',0);
set local role service_role;
select pg_temp.ok(public.learning_job_claim() is null,'exhausted budget performs no claim');
reset role;
select pg_temp.ok((select status='budget_wait' and next_at>now() from private.learning_jobs where target_id=:'chat2'),'quota wait has next eligibility time');
update private.learning_limits set daily_calls=100 where course_id=:'ca' and kind='chat';
update private.learning_jobs set next_at=now() where target_id=:'chat2';
set local role service_role;
select public.learning_job_claim() as claimed \gset
select :'claimed'::jsonb->>'id' as job, :'claimed'::jsonb->>'lease' as lease \gset
reset role;
update private.learning_jobs set lease_until=now()-interval '1 second' where id=:'job';
set local role service_role;
select pg_temp.ok(not public.learning_job_finish(:'job',:'lease','{"answer":"완료","sources":[]}','mock-model'),'expired lease cannot publish');
select public.learning_job_claim() as reclaimed \gset
select pg_temp.ok((:'reclaimed'::jsonb->>'id')=:'job' and (:'reclaimed'::jsonb->>'lease')<>:'lease','expired work is reclaimed with a new fence');
select pg_temp.ok(public.learning_job_fail(:'job',(:'reclaimed'::jsonb->>'lease')::uuid,'model_timeout',true,1000),'transient failure schedules bounded retry');
reset role;
update private.learning_jobs set attempts=max_attempts,status='running',lease_until=now()-interval '1 second' where id=:'job';
set local role service_role;
select public.learning_job_claim();
reset role;
select pg_temp.ok((select status='failed' from private.learning_jobs where id=:'job'),'max attempts terminates expired work');
-- Changing legacy class does not silently move historical v2 records.
update public.lab_members set class_id='qa-b' where user_id='22222222-2222-4222-8222-222222222222';
set local role authenticated;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select pg_temp.reject(format('select public.learning_snapshot(%L)',:'cb'),'forbidden');
select pg_temp.ok(jsonb_array_length(public.learning_snapshot(:'ca')->'attempts')=3,'historical membership is stable');
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.learning_command('remove_student',:'ca','22222222-2222-4222-8222-222222222222',null,'{}',gen_random_uuid());
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select pg_temp.reject(format('select public.learning_snapshot(%L)',:'ca'),'forbidden');
select pg_temp.reject(format('select public.learning_command(''join_course'',null,null,null,%L,gen_random_uuid())',jsonb_build_object('token',:'invite','alias','학생 A')::text),'forbidden');
reset role;
rollback;
