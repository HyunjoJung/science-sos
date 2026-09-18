alter table public.lab_records add column teacher_question text, add column review_note text, add column initial_stuck text, add column initial_note text, add column difficult boolean default false;
alter table public.lab_records drop constraint lab_records_item_id_check;
alter table public.lab_records add constraint lab_records_item_id_check check(item_id in ('D01','D02','D03','D07','D08','D09','D10','D11','D12','D13'));
alter table public.lab_records drop constraint lab_records_hypothesis_check;
alter table public.lab_records add constraint lab_records_hypothesis_check check(hypothesis in ('mass_only','size_only','liquid_missed','other','hold'));
create or replace function public.lab_act(p_action text,p_id uuid,p_version int,p_data jsonb,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare m public.lab_members;r public.lab_records; prior private.lab_requests; out_id uuid; next_h text; next_e text;
begin
 if p_request is null or p_action is null or p_data is null then raise exception 'invalid_input'; end if;
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
  insert into public.lab_records(student_id,item_id,prediction,reason,initial_stuck,initial_note,difficult) values(m.user_id,p_data->>'item',p_data->>'prediction',trim(p_data->>'reason'),left(coalesce(p_data->>'stuck',''),50),left(coalesce(p_data->>'note',''),300),coalesce((p_data->>'difficult')::boolean,false)) returning id into out_id;
 else
  select * into r from public.lab_records where id=p_id for update;
  if r.id is null or not exists(select 1 from public.lab_members s where s.user_id=r.student_id and s.class_id=m.class_id) or (m.role='student' and r.student_id<>m.user_id) then raise exception 'not_found'; end if;
  if p_version is null or r.version<>p_version then raise exception 'version_conflict'; end if;
  out_id:=r.id;
  insert into private.lab_history(record_id,actor,action,snapshot) values(r.id,m.user_id,p_action,to_jsonb(r));
  if p_action='review' then
   if m.role<>'teacher' or r.state not in ('awaiting_review','needs_more_reason','experiment_assigned') then raise exception 'forbidden_transition'; end if;
   if p_data->>'decision'='hold' then
    update public.lab_records set state='needs_more_reason',experiment_id=null,teacher_question=left(coalesce(nullif(trim(p_data->>'question'),''),'그렇게 생각한 이유를 조금 더 설명해 줄래요?'),500) where id=r.id;
   elsif p_data->>'decision' in ('confirm','edit') then
    next_h:=p_data->>'hypothesis';next_e:=p_data->>'experiment';
    if next_h not in ('mass_only','size_only','liquid_missed','other') or next_e not in ('wood80_iron20','split_wood','change_liquid','guided') or next_h is null or next_e is null then raise exception 'invalid_input'; end if;
    if r.item_id not in ('D01','D02','D03') and next_e<>'guided' then raise exception 'invalid_experiment';end if;
    update public.lab_records set state='experiment_assigned',hypothesis=next_h,experiment_id=next_e,review_note=left(coalesce(p_data->>'review_note',''),300) where id=r.id;
   else raise exception 'invalid_input';end if;
  elsif p_action='reason' then
   if m.role<>'student' or r.state<>'needs_more_reason' then raise exception 'forbidden_transition'; end if;
   if length(trim(coalesce(p_data->>'reason',''))) not between 1 and 300 then raise exception 'invalid_input'; end if;
   update public.lab_records set reason=trim(p_data->>'reason'),state='awaiting_review',hypothesis='hold',analysis_mode='pending',analysis_note='',experiment_id=null where id=r.id;
  elsif p_action='observe' then
   if m.role<>'student' or r.state<>'experiment_assigned' then raise exception 'forbidden_transition'; end if;
   if r.experiment_id='guided' and length(trim(coalesce(p_data->>'observation',''))) not between 1 and 500 then raise exception 'invalid_observation';end if;
   update public.lab_records set state='observed',observation=case r.experiment_id when 'guided' then trim(p_data->>'observation') when 'wood80_iron20' then '80g 나무는 뜨고 20g 철은 가라앉았습니다.' when 'split_wood' then '나누기 전후의 나무가 모두 떴습니다.' else '액체 A에서는 가라앉고 B에서는 떴습니다.' end where id=r.id;
  elsif p_action='revise' then
   if m.role<>'student' or r.state<>'observed' then raise exception 'forbidden_transition'; end if;
   if length(trim(coalesce(p_data->>'text',''))) not between 1 and 300 or length(coalesce(p_data->>'note',''))>200 or coalesce(p_data->>'stuck','') not in ('predict','observe','rewrite','none') then raise exception 'invalid_input'; end if;
   update public.lab_records set state='revised',revised_text=trim(p_data->>'text'),self_note=p_data->>'note',stuck_at=p_data->>'stuck' where id=r.id;
  elsif p_action='reassess' then
   if m.role<>'student' or r.state<>'revised' then raise exception 'forbidden_transition'; end if;
   if length(trim(coalesce(p_data->>'reason',''))) not between 1 and 300 or length(coalesce(p_data->>'prediction','')) not between 1 and 150 then raise exception 'invalid_input'; end if;
   update public.lab_records set state='reassessed',re_reason=trim(p_data->>'reason'),re_prediction=p_data->>'prediction' where id=r.id;
  elsif p_action='complete' then
   if m.role<>'teacher' or r.state<>'reassessed' then raise exception 'forbidden_transition'; end if;
   if coalesce(jsonb_typeof(p_data->'scores'),'null')<>'array' then raise exception 'invalid_input'; end if;
   if jsonb_array_length(p_data->'scores')<>3 or exists(select 1 from jsonb_array_elements(p_data->'scores') v where v::text not in ('0','1','2')) then raise exception 'invalid_input'; end if;
   update public.lab_records set state='completed',scores=array(select v::int from jsonb_array_elements_text(p_data->'scores') v) where id=r.id;
  else raise exception 'invalid_action';end if;
  update public.lab_records set version=version+1,updated_at=now() where id=r.id;
 end if;
 insert into private.lab_requests values(m.user_id,p_request,out_id,jsonb_build_object('action',p_action,'id',p_id,'version',p_version,'data',p_data));
 return out_id;
end $$;


create or replace function public.lab_experiment(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.lab_records;m public.lab_members;
begin
 select * into m from public.lab_members where user_id=auth.uid();
 select * into r from public.lab_records where id=p_id;
 if m.user_id is null or r.id is null or not exists(select 1 from public.lab_members where user_id=r.student_id and class_id=m.class_id) or (m.role='student' and r.student_id<>m.user_id) or r.state not in ('experiment_assigned','observed','revised','reassessed','completed') then raise exception 'not_authorized';end if;
 return case r.experiment_id
 when 'guided' then '{"id":"guided","left":"","right":"","leftFloats":false,"rightFloats":false,"detail":"교사와 조건을 비교하고 관찰한 내용을 기록해요.","result":""}'::jsonb
 when 'wood80_iron20' then '{"id":"wood80_iron20","left":"나무 80g","right":"철 20g","leftFloats":true,"rightFloats":false,"detail":"물 1.0 · 나무 0.8 · 철 약 7.8 g/cm³","result":"더 무거운 나무가 뜨고, 가벼운 철이 가라앉았어요."}'::jsonb
 when 'split_wood' then '{"id":"split_wood","left":"원래 나무 80g","right":"절반 나무 40g","leftFloats":true,"rightFloats":true,"detail":"나무 0.8 g/cm³ · 나누어도 밀도는 같아요","result":"나누기 전후 모두 떠요. 질량과 부피가 함께 줄었어요."}'::jsonb
 else '{"id":"change_liquid","left":"액체 A · 1.00","right":"액체 B · 1.10","leftFloats":false,"rightFloats":true,"detail":"같은 물체의 밀도 1.05 g/cm³","result":"같은 물체가 A에서는 가라앉고 B에서는 떠요."}'::jsonb end;
end $$;

