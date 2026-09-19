-- Additive v2: legacy tables/records and their migration history are left untouched.
-- Public RPCs use session identity; private tables are never writable by browsers.
create schema if not exists private;
create table private.learning_courses (
 id uuid primary key default gen_random_uuid(), legacy_class_id text unique,
 title text not null, daily_calls integer not null default 200 check(daily_calls between 0 and 10000)
);
create table private.learning_enrolments (
 course_id uuid references private.learning_courses(id), user_id uuid references auth.users(id),
 role text not null check(role in ('teacher','student')), active boolean not null default true,
 primary key(course_id,user_id)
);
insert into private.learning_courses(legacy_class_id,title)
 select distinct class_id, '학습 교실 · '||class_id from public.lab_members;
insert into private.learning_enrolments(course_id,user_id,role)
 select c.id,m.user_id,m.role from public.lab_members m join private.learning_courses c on c.legacy_class_id=m.class_id;
create table private.learning_packs (
 id text, version text, definition jsonb not null, created_at timestamptz not null default now(), primary key(id,version)
);
create table private.learning_assignments (
 id uuid primary key default gen_random_uuid(), course_id uuid not null references private.learning_courses(id),
 pack_id text not null, pack_version text not null, teacher_id uuid not null references auth.users(id),
 active boolean not null default true, created_at timestamptz not null default now(),
 foreign key(pack_id,pack_version) references private.learning_packs(id,version), unique(course_id,pack_id,pack_version)
);
create table private.learning_attempts (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references private.learning_assignments(id),
 course_id uuid not null references private.learning_courses(id), student_id uuid not null references auth.users(id),
 pack_id text not null, pack_version text not null, version integer not null default 1,
 stage text not null default 'awaiting_review' check(stage in ('awaiting_review','needs_clarification','activity_assigned','awaiting_transfer','awaiting_final_review','completed')),
 response jsonb not null, analysis jsonb, activity_id text, teacher_feedback text,
 activity_response jsonb, transfer_response jsonb, final_feedback text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(pack_id,pack_version) references private.learning_packs(id,version)
);
create index on private.learning_attempts(course_id,created_at desc,id desc);
create index on private.learning_attempts(student_id,created_at desc);
create table private.learning_requests (
 actor uuid not null, request uuid not null, payload jsonb not null, result_id uuid not null,
 created_at timestamptz not null default now(), primary key(actor,request)
);
create table private.learning_events (
 id bigint generated always as identity primary key, attempt_id uuid references private.learning_attempts(id),
 actor uuid, action text not null, snapshot jsonb not null, created_at timestamptz not null default now()
);
create table private.learning_jobs (
 id uuid primary key default gen_random_uuid(), attempt_id uuid not null references private.learning_attempts(id),
 course_id uuid not null references private.learning_courses(id), input_version integer not null,
 status text not null default 'queued' check(status in ('queued','running','retry_wait','succeeded','failed','cancelled')),
 attempts integer not null default 0, max_attempts integer not null default 3,
 available_at timestamptz not null default now(), lease uuid, lease_until timestamptz,
 error_code text, model text, usage jsonb, created_at timestamptz not null default now(), completed_at timestamptz,
 unique(attempt_id,input_version)
);
create index on private.learning_jobs(status,available_at,created_at);
create table private.learning_budget (
 course_id uuid references private.learning_courses(id), day date, calls integer not null default 0,
 primary key(course_id,day)
);
-- Role checks intentionally remain inside SECURITY DEFINER functions.
revoke all on schema private from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['learning_courses','learning_enrolments','learning_packs','learning_assignments','learning_attempts','learning_requests','learning_events','learning_jobs','learning_budget'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end $$;

-- Immutable definitions: a changed definition requires a new version.
create function public.learning_register_pack(p_pack jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare a jsonb; prior jsonb;
begin
 if jsonb_typeof(p_pack) is distinct from 'object' or coalesce(p_pack->>'id','') !~ '^[a-z][a-z0-9-]{1,79}$'
 or coalesce(p_pack->>'version','') !~ '^\d+\.\d+\.\d+$'
 or length(coalesce(p_pack->>'title','')) not between 1 and 200
 or length(coalesce(p_pack->>'subject','')) not between 1 and 80
 or length(coalesce(p_pack->>'scope','')) not between 1 and 4000
 or length(coalesce(p_pack->>'rubric','')) not between 1 and 4000
 or length(coalesce(p_pack->>'prompt','')) not between 1 and 2000
 or jsonb_typeof(p_pack->'choices') is distinct from 'array'
 or jsonb_typeof(p_pack->'activities') is distinct from 'array'
 or jsonb_typeof(p_pack->'transfer') is distinct from 'object'
 or jsonb_typeof(p_pack#>'{transfer,choices}') is distinct from 'array'
 or octet_length(p_pack::text)>64000 then raise exception 'invalid_input'; end if;
 if jsonb_array_length(p_pack->'choices') not between 2 and 12
 or jsonb_array_length(p_pack#>'{transfer,choices}') not between 2 and 12
 or jsonb_array_length(p_pack->'activities') not between 1 and 10
 or not (p_pack->'choices' @> jsonb_build_array(p_pack->>'correctAnswer'))
 or not (p_pack#>'{transfer,choices}' @> jsonb_build_array(p_pack#>>'{transfer,correctAnswer}'))
 or length(coalesce(p_pack#>>'{transfer,prompt}','')) not between 1 and 2000 then raise exception 'invalid_input'; end if;
 for a in select value from jsonb_array_elements(p_pack->'activities') loop
  if jsonb_typeof(a) is distinct from 'object' or coalesce(a->>'id','') !~ '^[a-z][a-z0-9-]{1,79}$'
  or coalesce(a->>'kind','') not in ('comparison','fraction_strips')
  or a->'approved' is distinct from 'true'::jsonb
  or length(coalesce(a->>'instruction','')) not between 1 and 4000 then raise exception 'invalid_input';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements((p_pack->'choices')||(p_pack#>'{transfer,choices}')) x where jsonb_typeof(x) is distinct from 'string' or length(trim(x#>>'{}')) not between 1 and 500)
 or (select count(*)<>count(distinct value) from jsonb_array_elements(p_pack->'choices'))
 or (select count(*)<>count(distinct value) from jsonb_array_elements(p_pack#>'{transfer,choices}')) then raise exception 'invalid_input';end if;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_pack->'activities')) then raise exception 'invalid_input';end if;
 insert into private.learning_packs(id,version,definition) values(p_pack->>'id',p_pack->>'version',p_pack) on conflict do nothing;
 select definition into prior from private.learning_packs where id=p_pack->>'id' and version=p_pack->>'version';
 if prior is distinct from p_pack then raise exception 'content_version_conflict';end if;
 return true;
end $$;

create function private.learning_check_response(p_response jsonb,p_item jsonb) returns void
language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(p_response) is distinct from 'object'
 or jsonb_typeof(p_response->'answer') is distinct from 'string'
 or not (p_item->'choices' @> jsonb_build_array(p_response->>'answer'))
 or jsonb_typeof(p_response->'reason') is distinct from 'string'
 or length(trim(coalesce(p_response->>'reason',''))) not between 1 and 2000 then raise exception 'invalid_input';end if;
end $$;

-- One RPC for commands: authorization, idempotency, version fence and enqueue are atomic.
create function public.learning_act(p_action text,p_id uuid,p_version int,p_data jsonb,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); role_name text; cid uuid; aid uuid; r private.learning_attempts;
 a private.learning_assignments; pack jsonb; prior private.learning_requests; payload jsonb;
 target text; old_snapshot jsonb;
begin
 if u is null then raise exception 'unauthorized';end if;
 if p_request is null or p_action is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16000 then raise exception 'invalid_input';end if;
 payload:=jsonb_build_object('action',p_action,'id',p_id,'version',p_version,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_request::text,620));
 -- Resolve and recheck current enrollment even for a replay.
 if p_action='activate_pack' then cid:=p_id;
 elsif p_action='submit' then
  select * into a from private.learning_assignments where id=p_id;
  cid:=a.course_id;
 else
  select * into r from private.learning_attempts where id=p_id for update;
  cid:=r.course_id;
 end if;
 select role into role_name from private.learning_enrolments where course_id=cid and user_id=u and active;
 if role_name is null or (r.id is not null and role_name='student' and r.student_id<>u) then raise exception 'not_found';end if;
 select * into prior from private.learning_requests where actor=u and request=p_request;
 if found then
  if prior.payload is distinct from payload then raise exception 'idempotency_conflict';end if;
  return prior.result_id;
 end if;
 if p_action='activate_pack' then
  if role_name<>'teacher' then raise exception 'forbidden';end if;
  if p_data->'reviewed' is distinct from 'true'::jsonb then raise exception 'invalid_input';end if;
  if not exists(select 1 from private.learning_packs where id=p_data->>'pack_id' and version=p_data->>'pack_version') then raise exception 'invalid_input';end if;
  insert into private.learning_assignments(course_id,pack_id,pack_version,teacher_id)
   values(cid,p_data->>'pack_id',p_data->>'pack_version',u)
   on conflict(course_id,pack_id,pack_version) do update set active=true returning id into aid;
 elsif p_action='submit' then
  if role_name<>'student' or not a.active then raise exception 'forbidden';end if;
  select definition into pack from private.learning_packs where id=a.pack_id and version=a.pack_version;
  perform private.learning_check_response(p_data,pack);
  perform pg_advisory_xact_lock(hashtextextended(u::text,621));
  if (select count(*) from private.learning_attempts where student_id=u and created_at>now()-interval '1 minute')>=5 then raise exception 'rate_limit';end if;
  insert into private.learning_attempts(assignment_id,course_id,student_id,pack_id,pack_version,response)
   values(a.id,cid,u,a.pack_id,a.pack_version,jsonb_build_object('answer',p_data->>'answer','reason',trim(p_data->>'reason'))) returning id into aid;
  insert into private.learning_jobs(attempt_id,course_id,input_version) values(aid,cid,1);
  insert into private.learning_events(attempt_id,actor,action,snapshot) values(aid,u,p_action,jsonb_build_object('response',p_data,'version',1));
 else
  if p_version is null or r.version<>p_version then raise exception 'version_conflict';end if;
  select definition into pack from private.learning_packs where id=r.pack_id and version=r.pack_version;
  old_snapshot:=to_jsonb(r); aid:=r.id;
  if p_action in ('request_clarification','assign_activity','confirm_understanding') then
   if role_name<>'teacher' or r.stage<>'awaiting_review' then raise exception 'forbidden_transition';end if;
   if length(trim(coalesce(p_data->>'feedback',''))) not between 1 and 2000 then raise exception 'invalid_input';end if;
   target:=case p_action when 'request_clarification' then 'needs_clarification' when 'assign_activity' then 'activity_assigned' else 'awaiting_transfer' end;
   if p_action='assign_activity' and not exists(select 1 from jsonb_array_elements(pack->'activities') x where x->>'id'=p_data->>'activity_id' and x->'approved'='true'::jsonb) then raise exception 'invalid_input';end if;
   update private.learning_attempts set stage=target,teacher_feedback=trim(p_data->>'feedback'),
    activity_id=case when p_action='assign_activity' then p_data->>'activity_id' else null end where id=r.id;
  elsif p_action='resubmit' then
   if role_name<>'student' or r.stage<>'needs_clarification' then raise exception 'forbidden_transition';end if;
   perform private.learning_check_response(p_data,pack);
   update private.learning_attempts set response=jsonb_build_object('answer',p_data->>'answer','reason',trim(p_data->>'reason')),
    stage='awaiting_review',analysis=null,activity_id=null where id=r.id;
  elsif p_action='complete_activity' then
   if role_name<>'student' or r.stage<>'activity_assigned' then raise exception 'forbidden_transition';end if;
   if length(trim(coalesce(p_data->>'observation',''))) not between 1 and 2000 or length(trim(coalesce(p_data->>'explanation',''))) not between 1 and 2000 then raise exception 'invalid_input';end if;
   update private.learning_attempts set stage='awaiting_transfer',activity_response=jsonb_build_object('observation',trim(p_data->>'observation'),'explanation',trim(p_data->>'explanation')) where id=r.id;
  elsif p_action='submit_transfer' then
   if role_name<>'student' or r.stage<>'awaiting_transfer' then raise exception 'forbidden_transition';end if;
   perform private.learning_check_response(p_data,pack->'transfer');
   update private.learning_attempts set stage='awaiting_final_review',transfer_response=jsonb_build_object('answer',p_data->>'answer','reason',trim(p_data->>'reason')) where id=r.id;
  elsif p_action='complete' then
   if role_name<>'teacher' or r.stage<>'awaiting_final_review' then raise exception 'forbidden_transition';end if;
   if length(trim(coalesce(p_data->>'feedback',''))) not between 1 and 2000 then raise exception 'invalid_input';end if;
   update private.learning_attempts set stage='completed',final_feedback=trim(p_data->>'feedback') where id=r.id;
  else raise exception 'invalid_action';end if;
  update private.learning_attempts set version=version+1,updated_at=now() where id=r.id;
  update private.learning_jobs set status='cancelled',lease=null,lease_until=null,completed_at=now()
   where attempt_id=r.id and status in ('queued','running','retry_wait');
  if p_action='resubmit' then insert into private.learning_jobs(attempt_id,course_id,input_version) values(r.id,cid,r.version+1);end if;
  insert into private.learning_events(attempt_id,actor,action,snapshot) values(r.id,u,p_action,old_snapshot);
 end if;
 insert into private.learning_requests(actor,request,payload,result_id) values(u,p_request,payload,aid);
 return aid;
end $$;

-- Bounded queries; transfer questions and activity answers are gated by stage.
create function public.learning_home() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); courses jsonb;
begin
 if u is null then raise exception 'unauthorized';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'role',e.role) order by c.title),'[]') into courses
 from private.learning_courses c join private.learning_enrolments e on e.course_id=c.id where e.user_id=u and e.active;
 return jsonb_build_object('user_id',u,'courses',courses);
end $$;
create function public.learning_list(p_course uuid,p_before timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); role_name text; rows jsonb; assignments jsonb; catalog jsonb;
begin
 if u is null then raise exception 'unauthorized';end if;
 select role into role_name from private.learning_enrolments where course_id=p_course and user_id=u and active;
 if role_name is null then raise exception 'not_found';end if;
 if (p_before is null)<>(p_before_id is null) then raise exception 'invalid_input';end if;
 select coalesce(jsonb_agg(x.doc order by x.created_at desc,x.id desc),'[]') into rows from (
  select r.id,r.created_at,
   (case when role_name='teacher' then to_jsonb(r) else to_jsonb(r)-'analysis' end)||jsonb_build_object(
    'job',(select jsonb_build_object('status',j.status,'attempts',j.attempts,'error_code',j.error_code,'available_at',j.available_at) from private.learning_jobs j where j.attempt_id=r.id order by input_version desc limit 1),
    'title',p.definition->>'title','prompt',p.definition->>'prompt','choices',p.definition->'choices',
    'activity',case when role_name='teacher' or r.stage in ('activity_assigned','awaiting_transfer','awaiting_final_review','completed') then (select a from jsonb_array_elements(p.definition->'activities') a where a->>'id'=r.activity_id) else null end,
    'activities',case when role_name='teacher' then p.definition->'activities' else null end,
    'transfer',case when role_name='teacher' then p.definition->'transfer' when r.stage in ('awaiting_transfer','awaiting_final_review','completed') then (p.definition->'transfer')-'correctAnswer' else null end
   ) as doc
  from private.learning_attempts r join private.learning_packs p on p.id=r.pack_id and p.version=r.pack_version
  where r.course_id=p_course and (role_name='teacher' or r.student_id=u)
   and (p_before is null or (r.created_at,r.id)<(p_before,p_before_id))
  order by r.created_at desc,r.id desc limit 51
 ) x;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'pack_id',a.pack_id,'pack_version',a.pack_version,'title',p.definition->>'title','subject',p.definition->>'subject','prompt',p.definition->>'prompt','choices',p.definition->'choices') order by a.created_at),'[]') into assignments
 from private.learning_assignments a join private.learning_packs p on p.id=a.pack_id and p.version=a.pack_version where a.course_id=p_course and a.active;
 if role_name='teacher' then select coalesce(jsonb_agg(definition order by id,version),'[]') into catalog from private.learning_packs;else catalog:='[]';end if;
 return jsonb_build_object('user_id',u,'role',role_name,'course_id',p_course,'attempts',coalesce((select jsonb_agg(value) from jsonb_array_elements(rows) with ordinality x(value,n) where n<=50),'[]'),
 'has_more',jsonb_array_length(rows)>50,'assignments',assignments,'catalog',catalog);
end $$;

create function public.learning_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.learning_jobs; r private.learning_attempts; pack jsonb; used int; cap int; token uuid:=gen_random_uuid();
begin
 -- All writers lock the attempt before a job, avoiding inversion with teacher commands.
 for r in select a.* from private.learning_attempts a where a.stage='awaiting_review' and exists(
  select 1 from private.learning_jobs x where x.attempt_id=a.id and x.input_version=a.version
   and ((x.status in ('queued','retry_wait') and x.available_at<=now()) or (x.status='running' and x.lease_until<now()))
 ) order by a.created_at for update skip locked limit 50 loop
  select * into j from private.learning_jobs where attempt_id=r.id and input_version=r.version for update;
  if j.attempts>=j.max_attempts then
   update private.learning_jobs set status='failed',error_code='attempts_exhausted',lease=null,lease_until=null,completed_at=now() where id=j.id;continue;
  end if;
  if not exists(select 1 from private.learning_enrolments where course_id=r.course_id and user_id=r.student_id and active)
   or not exists(select 1 from private.learning_assignments where id=r.assignment_id and active) then
   update private.learning_jobs set status='cancelled',error_code='access_revoked',lease=null,lease_until=null,completed_at=now() where id=j.id;continue;
  end if;
  select daily_calls into cap from private.learning_courses where id=r.course_id;
  insert into private.learning_budget(course_id,day) values(r.course_id,current_date) on conflict do nothing;
  select calls into used from private.learning_budget where course_id=r.course_id and day=current_date for update;
  if used>=cap then
   update private.learning_jobs set status='retry_wait',error_code='quota',available_at=(current_date+1)::timestamptz,lease=null,lease_until=null where id=j.id;continue;
  end if;
  update private.learning_budget set calls=calls+1 where course_id=r.course_id and day=current_date;
  update private.learning_jobs set status='running',attempts=attempts+1,lease=token,lease_until=now()+interval '90 seconds',error_code=null where id=j.id;
  select definition into pack from private.learning_packs where id=r.pack_id and version=r.pack_version;
  return jsonb_build_object('id',j.id,'lease',token,'input_version',r.version,'attempt_id',r.id,'response',r.response,'pack',pack);
 end loop;
 return null;
end $$;

create function public.learning_finish(p_job uuid,p_lease uuid,p_result jsonb,p_error text default null,p_retry boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare j private.learning_jobs; r private.learning_attempts; aid uuid; result jsonb;
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
  if p_error not in ('timeout','provider_unavailable','provider_auth','invalid_output','invalid_evidence','configuration','network') then raise exception 'invalid_input';end if;
  update private.learning_jobs set status=case when p_retry and attempts<max_attempts then 'retry_wait' else 'failed' end,
   error_code=p_error,available_at=now()+make_interval(secs=>least(300,5*(2^attempts)::int)),lease=null,lease_until=null,
   completed_at=case when p_retry and attempts<max_attempts then null else now() end where id=j.id;
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

revoke all on function public.learning_register_pack(jsonb),public.learning_act(text,uuid,int,jsonb,uuid),public.learning_home(),public.learning_list(uuid,timestamptz,uuid),public.learning_claim(),public.learning_finish(uuid,uuid,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.learning_home(),public.learning_list(uuid,timestamptz,uuid),public.learning_act(text,uuid,int,jsonb,uuid) to authenticated;
grant execute on function public.learning_register_pack(jsonb),public.learning_claim(),public.learning_finish(uuid,uuid,jsonb,text,boolean) to service_role;
revoke all on function private.learning_check_response(jsonb,jsonb) from public,anon,authenticated;
