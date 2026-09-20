-- Apply atomically AFTER 006. No legacy answer is rewritten or regraded.
-- Public MCP has NO access to these tables. Private deliveries are session-RPC only.
create table private.learning_resource_catalog (
 id text not null, version text not null, definition jsonb not null,
 pack_ids text[] not null, enabled boolean not null default true,
 primary key(id,version),
 check(id ~ '^[a-z][a-z0-9-]{0,63}$' and version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
 check(jsonb_typeof(definition)='object' and definition->>'id'=id and definition->>'version'=version),
 check(definition->>'url' ~ '^https://(phet\.colorado\.edu|www\.ebsmath\.co\.kr|www\.khanacademy\.org)/[a-zA-Z0-9/_-]*$')
);
create function private.protect_learning_resource_catalog() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'enabled') is distinct from (to_jsonb(old)-'enabled') then raise exception 'content_version_conflict';end if;
 return new;
end $$;
create trigger immutable_learning_resource_catalog before update on private.learning_resource_catalog
 for each row execute function private.protect_learning_resource_catalog();

alter table private.learning_attempts add column resource_revision integer not null default 1 check(resource_revision>0);
create table private.learning_resource_shares (
 id uuid primary key default gen_random_uuid(),
 attempt_id uuid not null references private.learning_attempts(id) on delete cascade,
 resource_id text not null, resource_version text not null, input_version integer not null,
 approved_by uuid references auth.users(id) on delete set null,
 approved_at timestamptz not null default now(), revoked_at timestamptz,
 foreign key(resource_id,resource_version) references private.learning_resource_catalog(id,version),
 unique(attempt_id,resource_id,resource_version,input_version)
);
alter table private.learning_resource_catalog enable row level security;
alter table private.learning_resource_shares enable row level security;
revoke all on private.learning_resource_catalog,private.learning_resource_shares from public,anon,authenticated,service_role;
revoke all on function private.protect_learning_resource_catalog() from public,anon,authenticated;

-- Generated from src/lib/mcp/catalog.mjs; deliberate, reviewable navigation metadata only.
with source(data) as (values
('{"id":"phet-buoyancy","version":"1.0.0","subject":"science","topic":"density","title":"PhET · 부력 탐구","provider":"University of Colorado Boulder / PhET","url":"https://phet.colorado.edu/en/simulations/buoyancy","kind":"simulation","language":"다국어 선택","summary":"밀도와 부력을 비교하는 시뮬레이션의 공식 안내 페이지입니다.","checkedAt":"2026-09-20","packIds":["science-density"],"notice":"외부 사이트로 이동합니다. 교사가 학년·언어·접근 조건과 수업 적합성을 직접 확인하세요. 교육과정 적합성이나 학습 효과를 인증한 자료가 아닙니다."}'::jsonb),
('{"id":"phet-fractions","version":"1.0.0","subject":"mathematics","topic":"fractions","title":"PhET · 분수 표현 탐구","provider":"University of Colorado Boulder / PhET","url":"https://phet.colorado.edu/en/simulations/fractions-intro","kind":"simulation","language":"다국어 선택","summary":"분수를 여러 표현으로 살펴보는 시뮬레이션의 공식 안내 페이지입니다.","checkedAt":"2026-09-20","packIds":["math-fractions"],"notice":"외부 사이트로 이동합니다. 교사가 학년·언어·접근 조건과 수업 적합성을 직접 확인하세요. 교육과정 적합성이나 학습 효과를 인증한 자료가 아닙니다."}'::jsonb),
('{"id":"ebs-math","version":"1.0.0","subject":"mathematics","topic":"fractions","title":"EBSMath · 수학 자료 찾기","provider":"EBS","url":"https://www.ebsmath.co.kr/","kind":"portal","language":"한국어","summary":"EBS 수학 학습 포털입니다. 특정 분수 강의가 아니라 교사가 자료를 찾는 시작 페이지입니다.","checkedAt":"2026-09-20","packIds":["math-fractions"],"notice":"외부 사이트로 이동합니다. 교사가 학년·언어·접근 조건과 수업 적합성을 직접 확인하세요. 교육과정 적합성이나 학습 효과를 인증한 자료가 아닙니다."}'::jsonb),
('{"id":"khan-fractions","version":"1.0.0","subject":"mathematics","topic":"fractions","title":"Khan Academy · 분수 단원","provider":"Khan Academy","url":"https://www.khanacademy.org/math/arithmetic/arith-review-fractions","kind":"course","language":"영어","summary":"분수 학습 단원의 공식 페이지입니다. 실제 수업에 사용할 설명과 연습 범위는 교사가 확인해야 합니다.","checkedAt":"2026-09-20","packIds":["math-fractions"],"notice":"외부 사이트로 이동합니다. 교사가 학년·언어·접근 조건과 수업 적합성을 직접 확인하세요. 교육과정 적합성이나 학습 효과를 인증한 자료가 아닙니다."}'::jsonb))
insert into private.learning_resource_catalog(id,version,definition,pack_ids)
 select data->>'id',data->>'version',data-'packIds',array(select jsonb_array_elements_text(data->'packIds')) from source;

-- Sharing has its OWN revision, so a resource approval does not invalidate an AI lease.
-- It also checks the displayed attempt version: a stale teacher screen cannot share on
-- behalf of a later answer. Replay returns the existing acknowledgement, never re-shares.
create function public.learning_resource_act(p_action text,p_id uuid,p_version int,p_data jsonb,p_request uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();r private.learning_attempts;c private.learning_resource_catalog;
 prior private.learning_requests;payload jsonb;input_ver int;share_id uuid;role_name text;
begin
 if u is null then raise exception 'unauthorized';end if;
 if p_action is null or p_action not in ('share_resource','revoke_resource') or p_request is null or p_id is null
 or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>2000 then raise exception 'invalid_input';end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('resource_id','resource_version','reviewed','attempt_version'))
 or jsonb_typeof(p_data->'resource_id') is distinct from 'string' or jsonb_typeof(p_data->'resource_version') is distinct from 'string'
 or jsonb_typeof(p_data->'attempt_version') is distinct from 'number' then raise exception 'invalid_input';end if;
 payload:=jsonb_build_object('action',p_action,'id',p_id,'version',p_version,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_request::text,620));
 select * into r from private.learning_attempts where id=p_id for update;
 select role into role_name from private.learning_enrolments where user_id=u and course_id=r.course_id and active;
 if r.id is null or role_name is null then raise exception 'not_found';end if;
 if role_name<>'teacher' then raise exception 'forbidden';end if;
 select * into prior from private.learning_requests where actor=u and request=p_request;
 if found then
  if prior.payload is distinct from payload then raise exception 'idempotency_conflict';end if;
  return prior.result_id;
 end if;
 if p_version is null or p_version<>r.resource_revision or p_data->'attempt_version' is distinct from to_jsonb(r.version) then raise exception 'version_conflict';end if;
 select * into c from private.learning_resource_catalog where id=p_data->>'resource_id' and version=p_data->>'resource_version';
 if c.id is null or not r.pack_id=any(c.pack_ids) then raise exception 'invalid_input';end if;
 select max(input_version) into input_ver from private.learning_jobs where attempt_id=r.id;
 if input_ver is null then raise exception 'invalid_input';end if;
 if p_action='share_resource' then
  if not c.enabled or p_data->'reviewed' is distinct from 'true'::jsonb then raise exception 'invalid_input';end if;
  if not exists(select 1 from private.learning_enrolments where course_id=r.course_id and user_id=r.student_id and active)
   or not exists(select 1 from private.learning_assignments where id=r.assignment_id and active) then raise exception 'not_found';end if;
  insert into private.learning_resource_shares(attempt_id,resource_id,resource_version,input_version,approved_by)
   values(r.id,c.id,c.version,input_ver,u)
   on conflict(attempt_id,resource_id,resource_version,input_version) do update
   set approved_by=u,approved_at=now(),revoked_at=null returning id into share_id;
 else
  update private.learning_resource_shares set revoked_at=now()
   where attempt_id=r.id and resource_id=c.id and resource_version=c.version and input_version=input_ver returning id into share_id;
  if share_id is null then raise exception 'not_found';end if;
 end if;
 update private.learning_attempts set resource_revision=resource_revision+1,updated_at=now() where id=r.id;
 insert into private.learning_events(attempt_id,actor,action,snapshot) values(r.id,u,p_action,
  jsonb_build_object('resource_id',c.id,'resource_version',c.version,'input_version',input_ver,'share_id',share_id));
 insert into private.learning_requests(actor,request,payload,result_id) values(u,p_request,payload,r.id);
 return r.id;
end $$;

-- Preserve the proven, role-filtered base view, but make its old entry private.
alter function public.learning_list(uuid,timestamptz,uuid) set schema private;
alter function private.learning_list(uuid,timestamptz,uuid) rename to learning_list_v1;
revoke all on function private.learning_list_v1(uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
create function public.learning_list(p_course uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb;doc jsonb;out_rows jsonb:='[]';r private.learning_attempts;candidates jsonb;shares jsonb;input_ver int;
begin
 base:=private.learning_list_v1(p_course,p_before,p_before_id);
 for doc in select value from jsonb_array_elements(base->'attempts') loop
  select * into r from private.learning_attempts where id=(doc->>'id')::uuid;
  select max(input_version) into input_ver from private.learning_jobs where attempt_id=r.id;
  select coalesce(jsonb_agg(c.definition||jsonb_build_object('share_id',s.id,'approved_at',s.approved_at) order by c.id),'[]') into shares
   from private.learning_resource_shares s join private.learning_resource_catalog c on c.id=s.resource_id and c.version=s.resource_version
   where s.attempt_id=r.id and s.input_version=input_ver and s.revoked_at is null and c.enabled;
  doc:=doc||jsonb_build_object('shared_resources',shares);
  if base->>'role'='teacher' then
   select coalesce(jsonb_agg(c.definition||jsonb_build_object('recommended',
    coalesce(r.analysis#>'{resourceLookup,candidates}','[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id',c.id,'version',c.version))) order by c.id),'[]') into candidates
    from private.learning_resource_catalog c where c.enabled and r.pack_id=any(c.pack_ids);
   doc:=doc||jsonb_build_object('resource_candidates',candidates);
  end if;
  out_rows:=out_rows||jsonb_build_array(doc);
 end loop;
 return base||jsonb_build_object('attempts',out_rows,'resource_protocol','teacher-approved-v1');
end $$;
revoke all on function public.learning_resource_act(text,uuid,int,jsonb,uuid),public.learning_list(uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.learning_resource_act(text,uuid,int,jsonb,uuid),public.learning_list(uuid,timestamptz,uuid) to authenticated;
