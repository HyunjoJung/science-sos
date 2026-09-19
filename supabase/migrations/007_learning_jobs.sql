-- Queue RPCs are service-role only. Model responses have no authority to advance learning stages.
create function public.learning_worker_ping(p_worker uuid,p_model text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_worker is null or length(trim(coalesce(p_model,''))) not between 1 and 120 then raise exception 'invalid_input';end if;
 insert into private.learning_workers values(p_worker,now(),p_model) on conflict(id) do update set seen_at=now(),model=excluded.model;
 delete from private.learning_workers where seen_at<now()-interval '7 days';
 return true;
end $$;
create function public.learning_job_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.learning_jobs; a public.learning_attempts; c public.learning_chats; s public.learning_assignments;
 p public.learning_packs; k private.learning_keys; token uuid; used int; cap int; global_used int; global_cap int; units int; input jsonb; utc_day date:=(now() at time zone 'UTC')::date;
begin
 -- Terminal expiration is explicit; it cannot create an immortal processing indicator.
 update private.learning_jobs set status='failed',error_code='lease_expired',completed_at=now()
 where status='running' and lease_until<now() and attempts>=max_attempts;
 perform pg_advisory_xact_lock(hashtextextended('learning_global_budget:'||utc_day::text,619));
 for j in select * from private.learning_jobs
  where ((status in ('queued','retry_wait','budget_wait') and next_at<=now()) or (status='running' and lease_until<now())) and attempts<max_attempts
  order by next_at,created_at,id for update skip locked limit 20 loop
  if j.kind='analysis' then
   select * into a from public.learning_attempts where id=j.target_id and course_id=j.course_id and input_revision=j.input_revision and stage='awaiting_review';
   if not found or not exists(select 1 from public.learning_members m join public.learning_courses course_row on course_row.id=m.course_id where m.course_id=j.course_id and m.user_id=a.student_id and m.active and not course_row.archived) then
    update private.learning_jobs set status='cancelled',completed_at=now(),error_code='stale_input' where id=j.id;continue;
   end if;
   select * into s from public.learning_assignments where id=a.assignment_id;
   select * into p from public.learning_packs where id=s.pack_id and version=s.pack_version;
   select * into k from private.learning_keys where pack_id=s.pack_id and pack_version=s.pack_version;
   input:=jsonb_build_object('prompt',p.spec->>'prompt','choice',a.choice,'reason',a.reason,'scope',p.scope,'expected',k.answer,'activities',p.spec->'activities');
   units:=1;
  else
   select * into c from public.learning_chats where id=j.target_id and course_id=j.course_id and answer is null;
   if not found or not exists(select 1 from public.learning_members m join public.learning_courses cc on cc.id=m.course_id where m.course_id=j.course_id and m.user_id=c.student_id and m.active and not cc.archived) then
    update private.learning_jobs set status='cancelled',completed_at=now(),error_code='stale_input' where id=j.id;continue;
   end if;
   input:=jsonb_build_object('question',c.question,'materials',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'content',content,'version',version)),'[]') from public.learning_materials where course_id=j.course_id and enabled));
   units:=2; -- answer plus bounded entailment verifier; reserve conservatively even on early abstention
  end if;
  select daily_calls into global_cap from private.learning_global_limit where id=true;
  select calls into global_used from private.learning_global_budget where day=utc_day;global_used:=coalesce(global_used,0);
  if global_used+units>coalesce(global_cap,0) then
   update private.learning_jobs set status='budget_wait',error_code='global_daily_quota',next_at=(utc_day+1)::timestamp at time zone 'UTC',lease=null,lease_until=null where id=j.id;continue;
  end if;
  select daily_calls into cap from private.learning_limits where course_id=j.course_id and kind=j.kind;cap:=coalesce(cap,100);
  perform pg_advisory_xact_lock(hashtextextended(j.course_id::text||j.kind||utc_day::text,617));
  select calls into used from private.learning_budget where course_id=j.course_id and day=utc_day and kind=j.kind;used:=coalesce(used,0);
  if used+units>cap then
   update private.learning_jobs set status='budget_wait',error_code='daily_quota',next_at=(utc_day+1)::timestamp at time zone 'UTC',lease=null,lease_until=null where id=j.id;continue;
  end if;
  insert into private.learning_budget values(j.course_id,utc_day,j.kind,units)
   on conflict(course_id,day,kind) do update set calls=private.learning_budget.calls+excluded.calls;
  insert into private.learning_global_budget values(utc_day,units) on conflict(day) do update set calls=private.learning_global_budget.calls+excluded.calls;
  token:=gen_random_uuid();
  update private.learning_jobs set status='running',attempts=attempts+1,lease=token,lease_until=now()+interval '120 seconds',error_code=null where id=j.id;
  return jsonb_build_object('id',j.id,'kind',j.kind,'lease',token,'attempt',j.attempts+1,'input',input);
 end loop;
 return null;
end $$;
create function public.learning_job_heartbeat(p_id uuid,p_lease uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update private.learning_jobs set lease_until=now()+interval '120 seconds' where id=p_id and lease=p_lease and status='running' and lease_until>now();return found;
end $$;
create function public.learning_job_finish(p_id uuid,p_lease uuid,p_result jsonb,p_model text) returns boolean language plpgsql security definer set search_path='' as $$
declare j private.learning_jobs; a public.learning_attempts; c public.learning_chats; source jsonb; material public.learning_materials; stage_ok boolean;
begin
 if coalesce(jsonb_typeof(p_result),'null')<>'object' or octet_length(p_result::text)>65536 or length(coalesce(p_model,'')) not between 1 and 120 then raise exception 'invalid_input';end if;
 select * into j from private.learning_jobs where id=p_id;
 if not found then return false;end if;
 -- Same lock order as commands (target first, job second) avoids review/finish deadlocks.
 if j.kind='analysis' then select * into a from public.learning_attempts where id=j.target_id for update;
 else select * into c from public.learning_chats where id=j.target_id for update;end if;
 select * into j from private.learning_jobs where id=p_id for update;
 if j.lease is distinct from p_lease then return false;end if;
 if j.status='succeeded' then return j.result=p_result;end if; -- lost ACK, same lease/result: idempotent success
 if j.status<>'running' or j.lease_until<=now() then return false;end if;
 if j.kind='analysis' then
  stage_ok:=a.id is not null and a.stage='awaiting_review' and a.input_revision=j.input_revision;
 else stage_ok:=c.id is not null and c.answer is null;end if;
 if not coalesce(stage_ok,false) or not exists(select 1 from public.learning_members m join public.learning_courses cc on cc.id=m.course_id where m.course_id=j.course_id and m.user_id=coalesce(a.student_id,c.student_id) and m.active and not cc.archived) then
  update private.learning_jobs set status='cancelled',completed_at=now(),error_code='stale_input' where id=j.id;return false;
 end if;
 if j.kind='analysis' then
  if p_result->>'interpretation' is null or p_result->>'interpretation' not in ('understood','misconception','uncertain','out_of_scope','ambiguous_item') or
   length(coalesce(p_result->>'note','')) not between 1 and 1000 or coalesce(jsonb_typeof(p_result->'evidence'),'null')<>'string' or
   (p_result->>'evidence'<>'' and position(p_result->>'evidence' in a.reason)=0) or
   (p_result->>'interpretation' in ('understood','misconception') and trim(p_result->>'evidence')='') then raise exception 'invalid_input';end if;
  update public.learning_attempts set analysis=p_result,updated_at=now() where id=a.id;
  insert into private.learning_events(course_id,attempt_id,action,snapshot) values(j.course_id,a.id,'analysis_applied',p_result);
 else
  if length(trim(coalesce(p_result->>'answer',''))) not between 1 and 4000 or coalesce(jsonb_typeof(p_result->'sources'),'null')<>'array' then raise exception 'invalid_input';end if;
  if jsonb_array_length(p_result->'sources')>4 then raise exception 'invalid_input';end if;
  for source in select * from jsonb_array_elements(p_result->'sources') loop
   select * into material from public.learning_materials where id=(source->>'material_id')::uuid and course_id=j.course_id for share;
   if not found or not material.enabled or material.version is distinct from (source->>'version')::int or length(trim(coalesce(source->>'quote',''))) not between 1 and 1000 or position(source->>'quote' in material.content)=0 then
    update private.learning_jobs set status='failed',error_code='source_changed',completed_at=now() where id=j.id;return false;
   end if;
  end loop;
  update public.learning_chats set answer=p_result->>'answer',sources=p_result->'sources' where id=c.id;
 end if;
 update private.learning_jobs set status='succeeded',result=p_result,model=p_model,completed_at=now(),error_code=null where id=j.id;
 return true;
end $$;
create function public.learning_job_fail(p_id uuid,p_lease uuid,p_code text,p_retry boolean,p_delay_ms integer)
 returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_code is null or p_code!~'^[a-zA-Z0-9_]{1,80}$' or p_retry is null or p_delay_ms is null or p_delay_ms not between 1000 and 300000 then raise exception 'invalid_input';end if;
 update private.learning_jobs set status=case when p_retry and attempts<max_attempts then 'retry_wait' else 'failed' end,
  error_code=p_code,next_at=now()+p_delay_ms*interval '1 millisecond',lease=null,lease_until=null,
  completed_at=case when p_retry and attempts<max_attempts then null else now() end
 where id=p_id and lease=p_lease and status='running' and lease_until>now();return found;
end $$;
revoke all on function public.learning_worker_ping(uuid,text),public.learning_job_claim(),public.learning_job_heartbeat(uuid,uuid),public.learning_job_finish(uuid,uuid,jsonb,text),public.learning_job_fail(uuid,uuid,text,boolean,int) from public,anon,authenticated;
grant execute on function public.learning_worker_ping(uuid,text),public.learning_job_claim(),public.learning_job_heartbeat(uuid,uuid),public.learning_job_finish(uuid,uuid,jsonb,text),public.learning_job_fail(uuid,uuid,text,boolean,int) to service_role;
