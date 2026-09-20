-- Additive function replacement. Apply AFTER 005 in one transaction.
-- Gateway credit/auth/policy/request errors are terminal even when a worker
-- incorrectly asks to retry; student answers and teacher review remain intact.
create or replace function public.learning_finish(p_job uuid,p_lease uuid,p_result jsonb,p_error text default null,p_retry boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare j private.learning_jobs; r private.learning_attempts; aid uuid; can_retry boolean;
begin
 select attempt_id into aid from private.learning_jobs where id=p_job;
 select * into r from private.learning_attempts where id=aid for update;
 select * into j from private.learning_jobs where id=p_job for update;
 if j.id is null or j.status<>'running' or j.lease is distinct from p_lease or j.lease_until<=now()
 or r.version<>j.input_version or r.stage<>'awaiting_review' then return false;end if;
 if not exists(select 1 from private.learning_enrolments where user_id=r.student_id and course_id=r.course_id and active)
 or not exists(select 1 from private.learning_assignments where id=r.assignment_id and active) then
  update private.learning_jobs set status='cancelled',lease=null,lease_until=null,error_code='access_revoked',completed_at=now() where id=j.id;return false;
 end if;
 if p_error is not null then
  if p_error not in ('timeout','provider_unavailable','provider_auth','provider_credit','provider_policy','provider_request','invalid_output','invalid_evidence','configuration','network') then raise exception 'invalid_input';end if;
  can_retry:=coalesce(p_retry,false) and p_error in ('timeout','network','provider_unavailable') and j.attempts<j.max_attempts;
  update private.learning_jobs set status=case when can_retry then 'retry_wait' else 'failed' end,
   error_code=p_error,available_at=case when can_retry then now()+make_interval(secs=>least(300,5*(2^attempts)::int)) else now() end,
   lease=null,lease_until=null,completed_at=case when can_retry then null else now() end where id=j.id;
  return true;
 end if;
 if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>20000
 or coalesce(p_result->>'interpretation','') not in ('understood','misconception','uncertain','out_of_scope','ambiguous_item')
 or coalesce(p_result->>'evidence','') not in ('supported','contradictory','insufficient')
 or coalesce(p_result->>'ruleVerdict','') not in ('correct','incorrect','unknown')
 or length(trim(coalesce(p_result->>'note',''))) not between 1 and 2000
 or length(coalesce(p_result->>'quote',''))>2000
 or (coalesce(p_result->>'quote','')<>'' and position((p_result->>'quote') in (r.response->>'reason'))=0)
 or (p_result->>'evidence'<>'insufficient' and length(trim(coalesce(p_result->>'quote','')))=0) then raise exception 'invalid_input';end if;
 update private.learning_attempts set analysis=p_result,updated_at=now() where id=r.id;
 update private.learning_jobs set status='succeeded',model=left(p_result->>'model',200),usage=p_result->'usage',lease=null,lease_until=null,completed_at=now() where id=j.id;
 insert into private.learning_events(attempt_id,action,snapshot) values(r.id,'analysis_completed',jsonb_build_object('input_version',j.input_version,'analysis',p_result));
 return true;
end $$;
revoke all on function public.learning_finish(uuid,uuid,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.learning_finish(uuid,uuid,jsonb,text,boolean) to service_role;
