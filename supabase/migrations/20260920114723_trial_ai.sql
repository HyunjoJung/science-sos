-- Isolated public AI trial. This migration has no dependency on learning migrations.
-- Browser roles have no access: only server-held service credentials may call these RPCs.
create table public.trial_jobs (
  id uuid primary key default gen_random_uuid(),
  session_hash text not null check (session_hash ~ '^[a-f0-9]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  request_id uuid not null,
  prediction text not null check (prediction in ('나무는 가라앉고 철은 떠요','나무는 뜨고 철은 가라앉아요','둘 다 떠요','둘 다 가라앉아요')),
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  status text not null default 'queued' check (status in ('queued','running','ready','error')),
  result jsonb,
  lease uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (session_hash,request_id),
  check ((status = 'ready') = (result is not null))
);
create table public.trial_control (
  singleton boolean primary key default true check (singleton),
  heartbeat_at timestamptz
);
insert into public.trial_control(singleton) values (true);
create index trial_jobs_session_created on public.trial_jobs(session_hash,created_at desc);
create index trial_jobs_ip_created on public.trial_jobs(ip_hash,created_at desc);
create index trial_jobs_created on public.trial_jobs(created_at);
create index trial_jobs_active on public.trial_jobs(created_at) where status in ('queued','running');
alter table public.trial_jobs enable row level security;
alter table public.trial_control enable row level security;
revoke all on public.trial_jobs,public.trial_control from public,anon,authenticated;
grant select,insert,update,delete on public.trial_jobs,public.trial_control to service_role;

-- Enumerate the response fields: hashes, request IDs and worker leases never leave the server.
create function public.trial_status(p_session_hash text default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.trial_jobs;
  v_online boolean;
  v_used integer := 0;
  v_day timestamptz := date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  if p_session_hash is not null and p_session_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_input'; end if;
  select coalesce(heartbeat_at > now() - interval '120 seconds',false) into v_online from public.trial_control where singleton;
  if p_session_hash is not null then
    select count(*) into v_used from public.trial_jobs where session_hash=p_session_hash and created_at>=v_day;
    select * into v_job from public.trial_jobs where session_hash=p_session_hash and created_at>now()-interval '24 hours' order by created_at desc,id desc limit 1;
  end if;
  return jsonb_build_object('online',coalesce(v_online,false),'remaining',greatest(0,3-v_used),'job',
    case when v_job.id is null then null else jsonb_build_object(
      'id',v_job.id,'status',case when (v_job.status='queued' and v_job.created_at<=now()-interval '5 minutes') or (v_job.status='running' and v_job.lease_expires_at<=now()) then 'error' else v_job.status end,
      'prediction',v_job.prediction,'reason',v_job.reason,'result',v_job.result,
      'created_at',v_job.created_at,'finished_at',coalesce(v_job.finished_at,
        case when v_job.status='queued' and v_job.created_at<=now()-interval '5 minutes' then v_job.created_at+interval '5 minutes'
        when v_job.status='running' and v_job.lease_expires_at<=now() then v_job.lease_expires_at else null end)) end);
end $$;

create function public.trial_enqueue(p_session_hash text,p_ip_hash text,p_request uuid,p_prediction text,p_reason text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.trial_jobs;
  v_day timestamptz := date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  v_reason text := btrim(p_reason);
begin
  if p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$'
    or p_request is null or p_prediction is null or p_prediction not in ('나무는 가라앉고 철은 떠요','나무는 뜨고 철은 가라앉아요','둘 다 떠요','둘 다 가라앉아요')
    or v_reason is null or char_length(v_reason) not between 1 and 300 then raise exception 'invalid_input'; end if;
  -- One transaction serializes all quota decisions, including simultaneous first-time sessions.
  perform pg_advisory_xact_lock(1926072026,1);
  select * into v_job from public.trial_jobs where session_hash=p_session_hash and request_id=p_request;
  if found then
    if v_job.created_at<=now()-interval '24 hours' or v_job.prediction<>p_prediction or v_job.reason<>v_reason then raise exception 'idempotency_conflict'; end if;
  else
    if not exists(select 1 from public.trial_control where singleton and heartbeat_at>now()-interval '120 seconds') then raise exception 'worker_unavailable'; end if;
    if (select count(*) from public.trial_jobs where session_hash=p_session_hash and created_at>=v_day)>=3
      or (select count(*) from public.trial_jobs where ip_hash=p_ip_hash and created_at>=v_day)>=10
      or (select count(*) from public.trial_jobs where created_at>=v_day)>=50
      or (select count(*) from public.trial_jobs where (status='queued' and created_at>now()-interval '5 minutes') or (status='running' and lease_expires_at>now()))>=5
      then raise exception 'rate_limit'; end if;
    insert into public.trial_jobs(session_hash,ip_hash,request_id,prediction,reason)
      values(p_session_hash,p_ip_hash,p_request,p_prediction,v_reason) returning * into v_job;
  end if;
  return jsonb_build_object('id',v_job.id,'status',case when (v_job.status='queued' and v_job.created_at<=now()-interval '5 minutes') or (v_job.status='running' and v_job.lease_expires_at<=now()) then 'error' else v_job.status end,
    'prediction',v_job.prediction,'reason',v_job.reason,'result',v_job.result,'created_at',v_job.created_at,'finished_at',coalesce(v_job.finished_at,
      case when v_job.status='queued' and v_job.created_at<=now()-interval '5 minutes' then v_job.created_at+interval '5 minutes'
      when v_job.status='running' and v_job.lease_expires_at<=now() then v_job.lease_expires_at else null end));
end $$;

create function public.trial_tick(p_claim boolean default true) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_job public.trial_jobs; v_lease uuid := gen_random_uuid();
begin
  update public.trial_control set heartbeat_at=now() where singleton;
  delete from public.trial_jobs where created_at<=now()-interval '24 hours';
  update public.trial_jobs set status='error',result=null,lease=null,lease_expires_at=null,finished_at=now()
    where (status='queued' and created_at<=now()-interval '5 minutes') or (status='running' and lease_expires_at<=now());
  if not coalesce(p_claim,false) then return null; end if;
  select * into v_job from public.trial_jobs where status='queued' order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  update public.trial_jobs set status='running',lease=v_lease,lease_expires_at=now()+interval '90 seconds' where id=v_job.id;
  return jsonb_build_object('id',v_job.id,'lease',v_lease,'prediction',v_job.prediction,'reason',v_job.reason);
end $$;

create function public.trial_finish(p_id uuid,p_lease uuid,p_result jsonb,p_error boolean) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare v_job public.trial_jobs;
begin
  select * into v_job from public.trial_jobs where id=p_id and lease=p_lease and status='running' and lease_expires_at>now() for update;
  if not found then return false; end if;
  if p_error is null then raise exception 'invalid_input'; end if;
  if not p_error then
    if p_result is null or jsonb_typeof(p_result)<>'object'
      or (select count(*) from jsonb_object_keys(p_result))<>4
      or not (p_result ?& array['hypothesis','reason_status','evidence','note'])
      or jsonb_typeof(p_result->'hypothesis')<>'string' or p_result->>'hypothesis' not in ('mass_only','size_only','liquid_missed','other','hold')
      or jsonb_typeof(p_result->'reason_status')<>'string' or p_result->>'reason_status' not in ('supported','contradictory','insufficient')
      or jsonb_typeof(p_result->'evidence')<>'string' or char_length(p_result->>'evidence')>300
      or jsonb_typeof(p_result->'note')<>'string' or char_length(p_result->>'note')>500 then raise exception 'invalid_input'; end if;
    if ((p_result->>'evidence')<>'' and (btrim(p_result->>'evidence')='' or strpos(v_job.reason,p_result->>'evidence')=0))
      or ((p_result->>'hypothesis')<>'hold' and (btrim(p_result->>'evidence')='' or p_result->>'reason_status'='insufficient')) then raise exception 'invalid_input'; end if;
  end if;
  update public.trial_jobs set status=case when p_error then 'error' else 'ready' end,
    result=case when p_error then null else p_result end,lease=null,lease_expires_at=null,finished_at=now() where id=v_job.id;
  return true;
end $$;

revoke all on function public.trial_status(text),public.trial_enqueue(text,text,uuid,text,text),public.trial_tick(boolean),public.trial_finish(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.trial_status(text),public.trial_enqueue(text,text,uuid,text,text),public.trial_tick(boolean),public.trial_finish(uuid,uuid,jsonb,boolean) to service_role;
