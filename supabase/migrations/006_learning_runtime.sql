-- Additive v2 rollout. Legacy records remain unchanged and accessible at the legacy UI.
-- Apply 001..006 in order to a staging database before promotion.
create table public.learning_courses (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text not null check(length(trim(title)) between 1 and 120),
 legacy_class text unique, archived boolean not null default false, created_at timestamptz not null default now()
);
create table public.learning_members (
 course_id uuid not null references public.learning_courses(id), user_id uuid not null references auth.users(id),
 role text not null check(role in ('teacher','student')), alias text not null check(length(trim(alias)) between 1 and 80),
 active boolean not null default true, primary key(course_id,user_id)
);
create table public.learning_packs (
 id text not null, version text not null, subject text not null, title text not null, scope text not null,
 spec jsonb not null check(jsonb_typeof(spec)='object'), primary key(id,version)
);
create table private.learning_keys (
 pack_id text not null, pack_version text not null, answer text not null, transfer_answer text not null, rubric jsonb not null,
 primary key(pack_id,pack_version), foreign key(pack_id,pack_version) references public.learning_packs(id,version)
);
create table public.learning_assignments (
 id uuid primary key default gen_random_uuid(), course_id uuid not null references public.learning_courses(id),
 pack_id text not null, pack_version text not null, reviewer uuid not null references auth.users(id),
 review_note text not null check(length(trim(review_note)) between 5 and 1000), created_at timestamptz not null default now(),
 foreign key(pack_id,pack_version) references public.learning_packs(id,version), unique(course_id,pack_id,pack_version), unique(id,course_id)
);
create table public.learning_attempts (
 id uuid primary key default gen_random_uuid(), course_id uuid not null, assignment_id uuid not null,
 student_id uuid not null, version integer not null default 1 check(version>0), input_revision integer not null default 1,
 stage text not null default 'awaiting_review' check(stage in ('awaiting_review','needs_clarification','activity_assigned','awaiting_transfer','awaiting_final_review','completed')),
 choice text not null, reason text not null check(length(trim(reason)) between 1 and 1000), analysis jsonb,
 activity_id text, teacher_note text, observation text, revised_text text, transfer_choice text, transfer_reason text, scores jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(assignment_id,course_id) references public.learning_assignments(id,course_id),
 foreign key(course_id,student_id) references public.learning_members(course_id,user_id), unique(assignment_id,student_id)
);
create table public.learning_materials (
 id uuid primary key default gen_random_uuid(), course_id uuid not null references public.learning_courses(id),
 title text not null check(length(trim(title)) between 1 and 120), content text not null check(length(trim(content)) between 1 and 30000),
 version integer not null default 1 check(version>0), enabled boolean not null default true, created_at timestamptz not null default now()
);
create table public.learning_chats (
 id uuid primary key default gen_random_uuid(), course_id uuid not null, student_id uuid not null,
 question text not null check(length(trim(question)) between 1 and 500), answer text, sources jsonb,
 created_at timestamptz not null default now(), foreign key(course_id,student_id) references public.learning_members(course_id,user_id)
);
create table private.learning_jobs (
 id uuid primary key default gen_random_uuid(), course_id uuid not null references public.learning_courses(id),
 kind text not null check(kind in ('analysis','chat')), target_id uuid not null, input_revision integer not null,
 status text not null default 'queued' check(status in ('queued','running','retry_wait','budget_wait','succeeded','failed','cancelled')),
 attempts integer not null default 0, max_attempts integer not null default 3 check(max_attempts between 1 and 10),
 next_at timestamptz not null default now(), lease uuid, lease_until timestamptz, error_code text,
 result jsonb, model text, created_at timestamptz not null default now(), completed_at timestamptz,
 unique(kind,target_id,input_revision)
);
create table private.learning_requests (
 actor uuid not null, request_id uuid not null, payload jsonb not null, result_id uuid not null,
 created_at timestamptz not null default now(), primary key(actor,request_id)
);
create table private.learning_events (
 id bigint generated always as identity primary key, course_id uuid not null, attempt_id uuid,
 actor uuid, action text not null, snapshot jsonb, created_at timestamptz not null default now()
);
create table private.learning_budget (
 course_id uuid not null, day date not null, kind text not null, calls integer not null default 0,
 primary key(course_id,day,kind)
);
-- Operator-controlled absolute cap; adding classrooms must not multiply the total API budget.
create table private.learning_global_limit (id boolean primary key default true check(id), daily_calls integer not null check(daily_calls between 0 and 100000));
insert into private.learning_global_limit values(true,100);
create table private.learning_global_budget (day date primary key, calls integer not null default 0);
create table private.learning_limits (
 course_id uuid not null references public.learning_courses(id), kind text not null check(kind in ('analysis','chat')),
 daily_calls integer not null default 100 check(daily_calls between 0 and 10000), primary key(course_id,kind)
);
create table private.learning_invites (
 token_hash text primary key, course_id uuid not null references public.learning_courses(id), expires_at timestamptz not null,
 uses integer not null default 0, max_uses integer not null default 100 check(max_uses between 1 and 500),
 request_id uuid not null, issued_by uuid not null
);
create table private.learning_invite_secrets (course_id uuid primary key references public.learning_courses(id), secret text not null);
create table private.learning_workers (id uuid primary key, seen_at timestamptz not null, model text not null);
create index on public.learning_members(user_id,active);
create index on public.learning_attempts(course_id,created_at desc,id desc);
create index on public.learning_chats(course_id,student_id,created_at desc);
create index on private.learning_jobs(next_at,created_at) where status in ('queued','running','retry_wait','budget_wait');
create index on private.learning_events(course_id,attempt_id,created_at);
-- Historical course membership is independent of mutable lab_members.class_id.
insert into public.learning_courses(tenant_id,title,legacy_class)
 select gen_random_uuid(),'기존 학습 교실',class_id from public.lab_members group by class_id;
insert into public.learning_members(course_id,user_id,role,alias)
 select c.id,m.user_id,m.role,m.alias from public.lab_members m join public.learning_courses c on c.legacy_class=m.class_id;

create function private.learning_role(p_course uuid) returns text language sql stable security definer set search_path='' as $$
 select m.role from public.learning_members m join public.learning_courses c on c.id=m.course_id
 where m.user_id=auth.uid() and m.course_id=p_course and m.active and not c.archived
$$;
create function private.learning_text(p jsonb, k text, lo int, hi int) returns text language plpgsql set search_path='' as $$
begin
 if coalesce(jsonb_typeof(p->k),'null')<>'string' or length(trim(p->>k)) not between lo and hi then raise exception 'invalid_input'; end if;
 return trim(p->>k);
end $$;

create function public.learning_command(p_action text,p_course uuid,p_id uuid,p_version integer,p_data jsonb,p_request uuid)
 returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); access_role text; previous private.learning_requests; out_id uuid; payload jsonb;
 a public.learning_attempts; assignment public.learning_assignments; pack public.learning_packs; member public.learning_members;
 next_stage text; activity text; value text; tenant uuid; invite private.learning_invites; target uuid;
begin
 if actor is null then raise exception 'unauthorized'; end if;
 if p_action is null or p_request is null or coalesce(jsonb_typeof(p_data),'null')<>'object' or octet_length(p_data::text)>131072 then raise exception 'invalid_input';end if;
 -- Serialize per actor: request identity and rate checks cannot race under parallel RPC calls.
 perform pg_advisory_xact_lock(hashtextextended(actor::text,612));
 access_role:=private.learning_role(p_course);
 if p_action not in ('join_course','create_course') and access_role is null then raise exception 'forbidden';end if;
 payload:=jsonb_build_object('action',p_action,'course',p_course,'id',p_id,'version',p_version,'data',case when p_action='join_course' then (p_data-'token')||jsonb_build_object('token_hash',encode(sha256(convert_to(coalesce(p_data->>'token',''),'UTF8')),'hex')) else p_data end);
 select * into previous from private.learning_requests lr where lr.actor=learning_command.actor and lr.request_id=p_request;
 if found then
  if previous.payload is distinct from payload then raise exception 'idempotency_conflict';end if;
  return previous.result_id;
 end if;
 if (select count(*) from private.learning_requests lr where lr.actor=learning_command.actor and lr.created_at>now()-interval '1 minute')>=30 then raise exception 'rate_limit';end if;
 if p_action='create_course' then
  if access_role is distinct from 'teacher' then raise exception 'forbidden';end if;
  select tenant_id into tenant from public.learning_courses where id=p_course;
  if (select count(*) from public.learning_courses where tenant_id=tenant)>=50 then raise exception 'rate_limit';end if;
  insert into public.learning_courses(tenant_id,title) values(tenant,private.learning_text(p_data,'title',1,120)) returning id into out_id;
  select * into member from public.learning_members where course_id=p_course and user_id=actor;
  insert into public.learning_members(course_id,user_id,role,alias) values(out_id,actor,'teacher',member.alias);
 elsif p_action='join_course' then
  value:=private.learning_text(p_data,'token',32,80);
  select * into invite from private.learning_invites where token_hash=encode(sha256(convert_to(value,'UTF8')),'hex') and expires_at>now() and uses<max_uses for update;
  if not found or exists(select 1 from public.learning_courses where id=invite.course_id and archived) then raise exception 'not_found';end if;
  if (select count(*) from public.learning_members where user_id=actor)>=100 then raise exception 'rate_limit';end if;
  if exists(select 1 from public.learning_members where course_id=invite.course_id and user_id=actor and not active) then raise exception 'forbidden';end if;
  insert into public.learning_members(course_id,user_id,role,alias) values(invite.course_id,actor,'student',private.learning_text(p_data,'alias',1,80)) on conflict do nothing;
  if found then update private.learning_invites set uses=uses+1 where token_hash=invite.token_hash;end if;
  out_id:=invite.course_id;
 elsif p_action='publish_assignment' then
  if access_role<>'teacher' then raise exception 'forbidden';end if;
  select * into pack from public.learning_packs where id=p_data->>'pack_id' and version=p_data->>'pack_version';
  if not found or p_data->'reviewed' is distinct from 'true'::jsonb then raise exception 'invalid_input';end if;
  value:=private.learning_text(p_data,'review_note',5,1000);
  insert into public.learning_assignments(course_id,pack_id,pack_version,reviewer,review_note) values(p_course,pack.id,pack.version,actor,value)
   on conflict(course_id,pack_id,pack_version) do nothing returning id into out_id;
  if out_id is null then select id into out_id from public.learning_assignments where course_id=p_course and pack_id=pack.id and pack_version=pack.version;end if;
 elsif p_action='submit' then
  if access_role<>'student' then raise exception 'forbidden';end if;
  select * into assignment from public.learning_assignments where id=p_id and course_id=p_course;
  if not found then raise exception 'not_found';end if;
  select * into pack from public.learning_packs where id=assignment.pack_id and version=assignment.pack_version;
  value:=private.learning_text(p_data,'choice',1,300);
  if not (pack.spec->'choices' ? value) then raise exception 'invalid_input';end if;
  insert into public.learning_attempts(course_id,assignment_id,student_id,choice,reason)
   values(p_course,p_id,actor,value,private.learning_text(p_data,'reason',1,1000))
   on conflict(assignment_id,student_id) do nothing returning id into out_id;
  if out_id is null then raise exception 'version_conflict';end if;
  insert into private.learning_jobs(course_id,kind,target_id,input_revision) values(p_course,'analysis',out_id,1);
 elsif p_action='material_add' then
  if access_role<>'teacher' then raise exception 'forbidden';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_course::text,615));
  if (select count(*) from public.learning_materials where course_id=p_course)>=50 then raise exception 'rate_limit';end if;
  insert into public.learning_materials(course_id,title,content) values(p_course,private.learning_text(p_data,'title',1,120),private.learning_text(p_data,'content',1,30000)) returning id into out_id;
 elsif p_action='material_edit' then
  if access_role<>'teacher' then raise exception 'forbidden';end if;
  if p_version is null or coalesce(jsonb_typeof(p_data->'enabled'),'null')<>'boolean' then raise exception 'invalid_input';end if;
  update public.learning_materials set enabled=(p_data->>'enabled')::boolean,version=version+1
   where id=p_id and course_id=p_course and version=p_version returning id into out_id;
  if out_id is null then raise exception 'version_conflict';end if;
 elsif p_action='chat_send' then
  if access_role<>'student' then raise exception 'forbidden';end if;
  if (select count(*) from public.learning_chats where student_id=actor and created_at>now()-interval '1 hour')>=20 then raise exception 'rate_limit';end if;
  insert into public.learning_chats(course_id,student_id,question) values(p_course,actor,private.learning_text(p_data,'question',1,500)) returning id into out_id;
  insert into private.learning_jobs(course_id,kind,target_id,input_revision) values(p_course,'chat',out_id,1);
 elsif p_action='remove_student' then
  if access_role<>'teacher' then raise exception 'forbidden';end if;
  update public.learning_members lm set active=false where lm.course_id=p_course and lm.user_id=p_id and lm.role='student' returning lm.user_id into out_id;
  if out_id is null then raise exception 'not_found';end if;
  update private.learning_jobs j set status='cancelled',completed_at=now() where course_id=p_course and status not in ('succeeded','failed','cancelled') and (
   exists(select 1 from public.learning_attempts ar where ar.id=j.target_id and ar.student_id=p_id) or exists(select 1 from public.learning_chats c where c.id=j.target_id and c.student_id=p_id));
 elsif p_action='retry_job' then
  if access_role<>'teacher' then raise exception 'forbidden';end if;
  -- Teacher retry is bounded by the same daily quota, and never revives terminal attempts or revoked students.
  update private.learning_jobs j set status='queued',attempts=0,next_at=now(),lease=null,lease_until=null,error_code=null
   where id=p_id and course_id=p_course and status='failed' and (
    (kind='analysis' and exists(select 1 from public.learning_attempts ar join public.learning_members m on m.course_id=ar.course_id and m.user_id=ar.student_id where ar.id=j.target_id and ar.input_revision=j.input_revision and ar.stage='awaiting_review' and m.active)) or
    (kind='chat' and exists(select 1 from public.learning_chats c join public.learning_members m on m.course_id=c.course_id and m.user_id=c.student_id where c.id=j.target_id and c.answer is null and m.active))) returning id into out_id;
  if out_id is null then raise exception 'version_conflict';end if;
 else
  select * into a from public.learning_attempts where id=p_id and course_id=p_course for update;
  if not found or (access_role='student' and a.student_id<>actor) then raise exception 'not_found';end if;
  if p_version is null or a.version<>p_version then raise exception 'version_conflict';end if;
  select * into assignment from public.learning_assignments where id=a.assignment_id;
  select * into pack from public.learning_packs where id=assignment.pack_id and version=assignment.pack_version;
  insert into private.learning_events(course_id,attempt_id,actor,action,snapshot) values(p_course,a.id,actor,p_action,to_jsonb(a));
  if p_action='request_clarification' and access_role='teacher' and a.stage='awaiting_review' then
   next_stage:='needs_clarification';value:=private.learning_text(p_data,'note',1,1000);
   update public.learning_attempts set teacher_note=value,activity_id=null where id=a.id;
  elsif p_action='confirm_understanding' and access_role='teacher' and a.stage='awaiting_review' then
   next_stage:='awaiting_transfer';value:=private.learning_text(p_data,'note',1,1000);
   update public.learning_attempts set teacher_note=value,activity_id=null where id=a.id;
  elsif p_action='assign_activity' and access_role='teacher' and a.stage='awaiting_review' then
   activity:=private.learning_text(p_data,'activity_id',1,80);
   if not exists(select 1 from jsonb_array_elements(pack.spec->'activities') x where x->>'id'=activity) then raise exception 'invalid_input';end if;
   next_stage:='activity_assigned';value:=private.learning_text(p_data,'note',1,1000);
   update public.learning_attempts set teacher_note=value,activity_id=activity where id=a.id;
  elsif p_action='resubmit' and access_role='student' and a.stage='needs_clarification' then
   next_stage:='awaiting_review';
   update public.learning_attempts set reason=private.learning_text(p_data,'reason',1,1000),analysis=null,input_revision=input_revision+1,activity_id=null where id=a.id;
   insert into private.learning_jobs(course_id,kind,target_id,input_revision) values(p_course,'analysis',a.id,a.input_revision+1);
  elsif p_action='complete_activity' and access_role='student' and a.stage='activity_assigned' then
   next_stage:='awaiting_transfer';
   update public.learning_attempts set observation=private.learning_text(p_data,'observation',1,1000),revised_text=private.learning_text(p_data,'revised_text',1,1000) where id=a.id;
  elsif p_action='submit_transfer' and access_role='student' and a.stage='awaiting_transfer' then
   value:=private.learning_text(p_data,'choice',1,300);
   if not (pack.spec->'transfer'->'choices' ? value) then raise exception 'invalid_input';end if;
   next_stage:='awaiting_final_review';
   update public.learning_attempts set transfer_choice=value,transfer_reason=private.learning_text(p_data,'reason',1,1000) where id=a.id;
  elsif p_action='complete' and access_role='teacher' and a.stage='awaiting_final_review' then
   if coalesce(jsonb_typeof(p_data->'scores'),'null')<>'array' then raise exception 'invalid_input';end if;
   if jsonb_array_length(p_data->'scores')<>3 or exists(select 1 from jsonb_array_elements(p_data->'scores') x where x::text not in ('0','1','2')) then raise exception 'invalid_input';end if;
   next_stage:='completed';
   update public.learning_attempts set scores=p_data->'scores',teacher_note=private.learning_text(p_data,'note',1,1000) where id=a.id;
  else raise exception 'forbidden_transition';end if;
  update public.learning_attempts set stage=next_stage,version=version+1,updated_at=now() where id=a.id;
  if next_stage<>'awaiting_review' then
   update private.learning_jobs set status='cancelled',completed_at=now() where kind='analysis' and target_id=a.id and status not in ('succeeded','failed','cancelled');
  end if;
  out_id:=a.id;
 end if;
 insert into private.learning_requests(actor,request_id,payload,result_id) values(actor,p_request,payload,out_id);
 return out_id;
end $$;

create function public.learning_snapshot(p_course uuid default null,p_before timestamptz default null,p_before_id uuid default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); access_role text; records jsonb; courses jsonb; count_records integer;
begin
 if actor is null then raise exception 'unauthorized';end if;
 if (p_before is null)<>(p_before_id is null) then raise exception 'invalid_input';end if;
 select coalesce(jsonb_agg(x order by x.title),'[]') into courses from (
  select c.id,c.title,c.tenant_id,m.role,m.alias from public.learning_courses c join public.learning_members m on m.course_id=c.id
  where m.user_id=actor and m.active and not c.archived order by c.created_at,c.id limit 100) x;
 if p_course is null then return jsonb_build_object('user_id',actor,'courses',courses);end if;
 access_role:=private.learning_role(p_course);if access_role is null then raise exception 'forbidden';end if;
 select coalesce(jsonb_agg(x.payload order by x.created_at desc,x.id desc),'[]'),count(*) into records,count_records from (
  select a.id,a.created_at, (case when access_role='teacher' then to_jsonb(a) else to_jsonb(a)-'analysis' end)||jsonb_build_object(
   'alias',m.alias,'job',(select jsonb_build_object('id',j.id,'status',j.status,'attempts',j.attempts,'next_at',j.next_at,'error_code',j.error_code) from private.learning_jobs j where j.kind='analysis' and j.target_id=a.id and j.input_revision=a.input_revision),
   'pack',jsonb_build_object('title',p.title,'subject',p.subject,'scope',p.scope,'spec',case when access_role='teacher' then p.spec else
    (p.spec-'transfer'-'activities') || jsonb_build_object('activities',case when a.stage in ('activity_assigned','awaiting_transfer','awaiting_final_review','completed') then (select coalesce(jsonb_agg(activity),'[]') from jsonb_array_elements(p.spec->'activities') activity where activity->>'id'=a.activity_id) else '[]'::jsonb end) ||
    case when a.stage in ('awaiting_transfer','awaiting_final_review','completed') then jsonb_build_object('transfer',p.spec->'transfer') else '{}'::jsonb end end)) as payload
  from public.learning_attempts a join public.learning_members m on m.course_id=a.course_id and m.user_id=a.student_id
   join public.learning_assignments s on s.id=a.assignment_id join public.learning_packs p on p.id=s.pack_id and p.version=s.pack_version
  where a.course_id=p_course and (access_role='teacher' or a.student_id=actor) and (p_before is null or (a.created_at,a.id)<(p_before,p_before_id))
  order by a.created_at desc,a.id desc limit 51) x;
 return jsonb_build_object('user_id',actor,'courses',courses,'role',access_role,'attempts',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(records) with ordinality as e(v,n) where n<=50),'has_more',count_records>50,
  'packs',case when access_role='teacher' then (select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('key',to_jsonb(k)-'pack_id'-'pack_version')),'[]') from public.learning_packs p join private.learning_keys k on k.pack_id=p.id and k.pack_version=p.version) else '[]'::jsonb end,
  'assignments',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',p.title,'subject',p.subject,'scope',p.scope,'pack_id',p.id,'pack_version',p.version,'spec',(p.spec-'transfer'-'activities')||jsonb_build_object('activities','[]'::jsonb),'attempt_id',(select id from public.learning_attempts where assignment_id=a.id and student_id=actor)) order by a.created_at),'[]') from public.learning_assignments a join public.learning_packs p on p.id=a.pack_id and p.version=a.pack_version where a.course_id=p_course),
  'members',case when access_role='teacher' then (select coalesce(jsonb_agg(to_jsonb(m)-'course_id'),'[]') from public.learning_members m where m.course_id=p_course) else '[]'::jsonb end,
  'materials',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'version',m.version,'enabled',m.enabled)),'[]') from public.learning_materials m where m.course_id=p_course and (access_role='teacher' or m.enabled)),
  'chats',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at),'[]') from (
    select c.id,c.question,case when valid.ok then c.answer else '자료가 변경되거나 비공개로 전환되어 이전 답변을 숨겼어요. 새로 질문해 주세요.' end as answer,c.created_at,case when valid.ok and c.answer is not null then c.sources else '[]'::jsonb end as sources,
     (select jsonb_build_object('id',j.id,'status',j.status,'error_code',j.error_code) from private.learning_jobs j where kind='chat' and target_id=c.id) as job
    from public.learning_chats c cross join lateral (select not exists(select 1 from jsonb_array_elements(coalesce(c.sources,'[]')) src where not exists(select 1 from public.learning_materials lm where lm.id=(src->>'material_id')::uuid and lm.course_id=p_course and lm.enabled and lm.version=(src->>'version')::int)) as ok) valid where c.course_id=p_course and (access_role='teacher' or c.student_id=actor) order by c.created_at desc,c.id desc limit 20) x),
  'worker_online',exists(select 1 from private.learning_workers where seen_at>now()-interval '90 seconds'));
end $$;

-- Stable effect and stable response for a retried invite issuance. Only the token hash
-- is kept with the invite; its derivation secret is separately restricted to this schema.
create function public.learning_invite(p_course uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare token text; secret_value text; actor uuid:=auth.uid(); prior private.learning_requests;
 current_invite private.learning_invites; payload jsonb;
begin
 if private.learning_role(p_course) is distinct from 'teacher' then raise exception 'forbidden';end if;
 if p_request is null then raise exception 'invalid_input';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,612));
 perform pg_advisory_xact_lock(hashtextextended(p_course::text,616));
 payload:=jsonb_build_object('action','invite','course',p_course);
 select * into prior from private.learning_requests lr where lr.actor=learning_invite.actor and lr.request_id=p_request;
 if found then
  if prior.payload is distinct from payload then raise exception 'idempotency_conflict';end if;
  select * into current_invite from private.learning_invites where course_id=p_course and request_id=p_request and issued_by=actor and expires_at>now();
  if not found then raise exception 'idempotency_conflict';end if;
 else
  if (select count(*) from private.learning_requests lr where lr.actor=learning_invite.actor and lr.created_at>now()-interval '1 minute')>=30 then raise exception 'rate_limit';end if;
 end if;
 insert into private.learning_invite_secrets values(p_course,replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')) on conflict do nothing;
 select x.secret into secret_value from private.learning_invite_secrets x where x.course_id=p_course;
 token:=encode(sha256(convert_to(secret_value||':'||p_course::text||':'||actor::text||':'||p_request::text,'UTF8')),'hex');
 if prior.request_id is null then
  delete from private.learning_invites where course_id=p_course;
  insert into private.learning_invites(token_hash,course_id,expires_at,request_id,issued_by) values(encode(sha256(convert_to(token,'UTF8')),'hex'),p_course,now()+interval '24 hours',p_request,actor) returning * into current_invite;
  insert into private.learning_requests(actor,request_id,payload,result_id) values(actor,p_request,payload,p_course);
 end if;
 return jsonb_build_object('token',token,'expires_at',current_invite.expires_at);
end $$;

-- Authenticated readers/writers cannot access tables directly. RPCs enforce authorization.
do $$ declare t record;begin
 for t in select schemaname,tablename from pg_tables where schemaname in ('public','private') and tablename like 'learning_%' loop
  execute format('alter table %I.%I enable row level security',t.schemaname,t.tablename);
  execute format('revoke all on %I.%I from public,anon,authenticated',t.schemaname,t.tablename);
 end loop;
end $$;
revoke all on function private.learning_role(uuid),private.learning_text(jsonb,text,int,int) from public,anon,authenticated;
revoke all on function public.learning_command(text,uuid,uuid,int,jsonb,uuid),public.learning_snapshot(uuid,timestamptz,uuid),public.learning_invite(uuid,uuid) from public,anon,authenticated;
grant execute on function public.learning_command(text,uuid,uuid,int,jsonb,uuid),public.learning_snapshot(uuid,timestamptz,uuid),public.learning_invite(uuid,uuid) to authenticated;
