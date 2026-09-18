-- Science SOS: protected tables, role-checked transactional API. No real student data.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table public.lab_members (user_id uuid primary key references auth.users(id), alias text not null, role text not null check(role in ('student','teacher')), class_id text not null default 'science-01');
create table public.lab_records (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references public.lab_members(user_id), item_id text not null check(item_id in ('D01','D02','D03')),
 prediction text not null, reason text not null check(length(trim(reason)) between 1 and 300), version int not null default 1,
 state text not null default 'awaiting_review' check(state in ('awaiting_review','needs_more_reason','experiment_assigned','observed','revised','reassessed','completed')),
 hypothesis text not null default 'hold' check(hypothesis in ('mass_only','size_only','liquid_missed','hold')),
 analysis_mode text not null default 'pending', analysis_note text not null default '', experiment_id text,
 observation text, revised_text text, self_note text, stuck_at text, re_prediction text, re_reason text, scores int[],
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table private.lab_history (id bigint generated always as identity primary key,record_id uuid references public.lab_records(id),actor uuid, action text, snapshot jsonb,created_at timestamptz default now());
create table private.lab_requests (actor uuid,request_id uuid,result_id uuid,payload jsonb,primary key(actor,request_id));
create table private.lab_ai_jobs (record_id uuid,version int,lease uuid,expires_at timestamptz,done boolean default false,primary key(record_id,version));
create table private.lab_ai_budget (day date primary key,calls int not null default 0);
alter table public.lab_members enable row level security;
alter table public.lab_records enable row level security;
create policy member_self on public.lab_members for select to authenticated using(user_id=auth.uid());
grant select on public.lab_members to authenticated;
revoke all on public.lab_records from anon,authenticated;
create index lab_student_idx on public.lab_records(student_id);
create index lab_members_class_idx on public.lab_members(class_id);

create function public.lab_list() returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lab_members; result jsonb;
begin
 select * into m from public.lab_members where user_id=auth.uid();
 if m.user_id is null then raise exception 'unauthorized'; end if;
 select coalesce(jsonb_agg(case when m.role='teacher' then to_jsonb(r)||jsonb_build_object('student_alias',s.alias) else (to_jsonb(r)-'analysis_note'-'hypothesis')||jsonb_build_object('student_alias',s.alias) end order by r.created_at desc),'[]'::jsonb)
 into result from public.lab_records r join public.lab_members s on s.user_id=r.student_id
 where s.class_id=m.class_id and (m.role='teacher' or r.student_id=m.user_id);
 return jsonb_build_object('member',to_jsonb(m),'records',result);
end $$;

create function public.lab_act(p_action text,p_id uuid,p_version int,p_data jsonb,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare m public.lab_members;r public.lab_records; prior private.lab_requests; out_id uuid; next_h text; next_e text;
begin
 select * into m from public.lab_members where user_id=auth.uid();
 if m.user_id is null then raise exception 'unauthorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended(m.user_id::text||p_request::text,0));
 select * into prior from private.lab_requests where actor=m.user_id and request_id=p_request;
 if found then
  if prior.payload<>jsonb_build_object('action',p_action,'id',p_id,'version',p_version,'data',p_data) then raise exception 'idempotency_conflict'; end if;
  return prior.result_id;
 end if;
 if p_action='submit' then
  if m.role<>'student' then raise exception 'forbidden'; end if;
  if length(trim(coalesce(p_data->>'reason','')))<1 or length(p_data->>'reason')>300 or length(coalesce(p_data->>'prediction','')) not between 1 and 150 then raise exception 'invalid_input'; end if;
  if (select count(*) from public.lab_records where student_id=m.user_id and created_at>now()-interval '1 minute')>=5 then raise exception 'rate_limit'; end if;
  insert into public.lab_records(student_id,item_id,prediction,reason) values(m.user_id,p_data->>'item',p_data->>'prediction',trim(p_data->>'reason')) returning id into out_id;
 else
  select * into r from public.lab_records where id=p_id for update;
  if r.id is null or not exists(select 1 from public.lab_members s where s.user_id=r.student_id and s.class_id=m.class_id) or (m.role='student' and r.student_id<>m.user_id) then raise exception 'not_found'; end if;
  if r.version<>p_version then raise exception 'version_conflict'; end if;
  out_id:=r.id;
  insert into private.lab_history(record_id,actor,action,snapshot) values(r.id,m.user_id,p_action,to_jsonb(r));
  if p_action='review' then
   if m.role<>'teacher' or r.state not in ('awaiting_review','needs_more_reason','experiment_assigned') then raise exception 'forbidden_transition'; end if;
   if p_data->>'decision'='hold' then
    update public.lab_records set state='needs_more_reason',experiment_id=null,analysis_note='어떤 조건을 보고 그렇게 생각했나요? 이유를 조금 더 설명해 주세요.' where id=r.id;
   elsif p_data->>'decision' in ('confirm','edit') then
    next_h:=p_data->>'hypothesis';next_e:=p_data->>'experiment';
    if next_h not in ('mass_only','size_only','liquid_missed') or next_e not in ('wood80_iron20','split_wood','change_liquid') or next_h is null or next_e is null then raise exception 'invalid_input'; end if;
    update public.lab_records set state='experiment_assigned',hypothesis=next_h,experiment_id=next_e where id=r.id;
   else raise exception 'invalid_input';end if;
  elsif p_action='reason' then
   if m.role<>'student' or r.state<>'needs_more_reason' then raise exception 'forbidden_transition'; end if;
   if length(trim(coalesce(p_data->>'reason',''))) not between 1 and 300 then raise exception 'invalid_input'; end if;
   update public.lab_records set reason=trim(p_data->>'reason'),state='awaiting_review',hypothesis='hold',analysis_mode='pending',analysis_note='',experiment_id=null where id=r.id;
  elsif p_action='observe' then
   if m.role<>'student' or r.state<>'experiment_assigned' then raise exception 'forbidden_transition'; end if;
   update public.lab_records set state='observed',observation=case r.experiment_id when 'wood80_iron20' then '80g 나무는 뜨고 20g 철은 가라앉았습니다.' when 'split_wood' then '나누기 전후의 나무가 모두 떴습니다.' else '액체 A에서는 가라앉고 B에서는 떴습니다.' end where id=r.id;
  elsif p_action='revise' then
   if m.role<>'student' or r.state<>'observed' then raise exception 'forbidden_transition'; end if;
   if length(trim(coalesce(p_data->>'text',''))) not between 1 and 300 or length(coalesce(p_data->>'note',''))>200 or p_data->>'stuck' not in ('predict','observe','rewrite','none') then raise exception 'invalid_input'; end if;
   update public.lab_records set state='revised',revised_text=trim(p_data->>'text'),self_note=p_data->>'note',stuck_at=p_data->>'stuck' where id=r.id;
  elsif p_action='reassess' then
   if m.role<>'student' or r.state<>'revised' then raise exception 'forbidden_transition'; end if;
   if length(trim(coalesce(p_data->>'reason',''))) not between 1 and 300 or length(coalesce(p_data->>'prediction','')) not between 1 and 150 then raise exception 'invalid_input'; end if;
   update public.lab_records set state='reassessed',re_reason=trim(p_data->>'reason'),re_prediction=p_data->>'prediction' where id=r.id;
  elsif p_action='complete' then
   if m.role<>'teacher' or r.state<>'reassessed' then raise exception 'forbidden_transition'; end if;
   if jsonb_array_length(p_data->'scores')<>3 or exists(select 1 from jsonb_array_elements_text(p_data->'scores') v where v::int not between 0 and 2) then raise exception 'invalid_input'; end if;
   update public.lab_records set state='completed',scores=array(select v::int from jsonb_array_elements_text(p_data->'scores') v) where id=r.id;
  else raise exception 'invalid_action';end if;
  update public.lab_records set version=version+1,updated_at=now() where id=r.id;
 end if;
 insert into private.lab_requests values(m.user_id,p_request,out_id,jsonb_build_object('action',p_action,'id',p_id,'version',p_version,'data',p_data));
 return out_id;
end $$;

create function public.lab_experiment(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.lab_records;m public.lab_members;
begin
 select * into m from public.lab_members where user_id=auth.uid();
 select * into r from public.lab_records where id=p_id;
 if m.user_id is null or r.id is null or not exists(select 1 from public.lab_members where user_id=r.student_id and class_id=m.class_id) or (m.role='student' and r.student_id<>m.user_id) or r.state not in ('experiment_assigned','observed','revised','reassessed','completed') then raise exception 'not_authorized';end if;
 return case r.experiment_id
 when 'wood80_iron20' then '{"id":"wood80_iron20","left":"나무 80g","right":"철 20g","leftFloats":true,"rightFloats":false,"detail":"물 1.0 · 나무 0.8 · 철 약 7.8 g/cm³","result":"더 무거운 나무가 뜨고, 가벼운 철이 가라앉았어요."}'::jsonb
 when 'split_wood' then '{"id":"split_wood","left":"원래 나무 80g","right":"절반 나무 40g","leftFloats":true,"rightFloats":true,"detail":"나무 0.8 g/cm³ · 나누어도 밀도는 같아요","result":"나누기 전후 모두 떠요. 질량과 부피가 함께 줄었어요."}'::jsonb
 else '{"id":"change_liquid","left":"액체 A · 1.00","right":"액체 B · 1.10","leftFloats":false,"rightFloats":true,"detail":"같은 물체의 밀도 1.05 g/cm³","result":"같은 물체가 A에서는 가라앉고 B에서는 떠요."}'::jsonb end;
end $$;

create function public.lab_ai_claim(p_id uuid,p_version int) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.lab_records;j private.lab_ai_jobs;n int;t uuid:=gen_random_uuid();
begin
 select * into r from public.lab_records where id=p_id for update;
 if r.id is null or r.version<>p_version or r.state<>'awaiting_review' then return null;end if;
 select * into j from private.lab_ai_jobs where record_id=p_id and version=p_version;
 if found and (j.done or j.expires_at>now()) then return null;end if;
 insert into private.lab_ai_budget values(current_date,1) on conflict(day) do update set calls=private.lab_ai_budget.calls+1 returning calls into n;
 if n>100 then raise exception 'rate_limit';end if;
 insert into private.lab_ai_jobs(record_id,version,lease,expires_at) values(p_id,p_version,t,now()+interval '30 seconds') on conflict(record_id,version) do update set lease=t,expires_at=now()+interval '30 seconds';
 return to_jsonb(r)||jsonb_build_object('lease',t);
end $$;
create function public.lab_ai_finish(p_id uuid,p_version int,p_lease uuid,p_hypothesis text,p_note text,p_mode text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.lab_records where id=p_id and version=p_version and state='awaiting_review' for update;
 if not found then return false;end if;
 perform 1 from private.lab_ai_jobs where record_id=p_id and version=p_version and lease=p_lease and not done for update;
 if not found then return false;end if;
 update public.lab_records set hypothesis=p_hypothesis,analysis_note=p_note,analysis_mode=p_mode where id=p_id;
 update private.lab_ai_jobs set done=true where record_id=p_id and version=p_version;
 return true;
end $$;

revoke all on function public.lab_list(),public.lab_act(text,uuid,int,jsonb,uuid),public.lab_experiment(uuid),public.lab_ai_claim(uuid,int),public.lab_ai_finish(uuid,int,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.lab_list(),public.lab_act(text,uuid,int,jsonb,uuid),public.lab_experiment(uuid) to authenticated;
grant execute on function public.lab_ai_claim(uuid,int),public.lab_ai_finish(uuid,int,uuid,text,text,text) to service_role;
