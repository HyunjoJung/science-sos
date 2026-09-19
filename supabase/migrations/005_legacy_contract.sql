-- Complete the legacy validation boundary without rewriting existing records.
-- Choices are the public catalogue at a31aa5b; answer keys remain separate.
create table private.lab_content_contract (
 id text primary key, choices jsonb not null check(jsonb_typeof(choices)='array'), transfer_id text
);
alter table private.lab_content_contract enable row level security;
revoke all on private.lab_content_contract from public,anon,authenticated;
insert into private.lab_content_contract(id,choices,transfer_id) values
 ('D01','["나무는 가라앉고 철은 떠요","나무는 뜨고 철은 가라앉아요","둘 다 떠요","둘 다 가라앉아요","아직 모르겠다"]'::jsonb,'D04'),
 ('D02','["나눈 나무는 가라앉아요","나누기 전후 모두 떠요","크기만으로 알 수 있어요","아직 모르겠다"]'::jsonb,'D05'),
 ('D03','["두 액체에서 모두 가라앉아요","A에서는 가라앉고 B에서는 떠요","두 액체에서 모두 떠요","아직 모르겠다"]'::jsonb,'D06'),
 ('D04','["A는 뜨고 B는 가라앉아요","A는 가라앉고 B는 떠요","둘 다 떠요","아직 모르겠다"]'::jsonb,null),
 ('D05','["나누기 전후 모두 가라앉아요","반으로 나누면 떠요","나누기 전후 모두 떠요","아직 모르겠다"]'::jsonb,null),
 ('D06','["0.90에서는 가라앉고 1.00에서는 떠요","두 액체에서 모두 떠요","두 액체에서 모두 가라앉아요","아직 모르겠다"]'::jsonb,null),
 ('D07','["110g","100g","10g","아직 모르겠다"]'::jsonb,'D14'),
 ('D08','["꺼진다","더 밝아진다","그대로 켜진다","아직 모르겠다"]'::jsonb,'D15'),
 ('D09','["금속이 손의 열을 더 빠르게 전달한다","금속의 온도가 항상 더 낮다","나무가 열을 만든다","아직 모르겠다"]'::jsonb,'D16'),
 ('D10','["이산화 탄소","산소","질소","아직 모르겠다"]'::jsonb,'D17'),
 ('D11','["햇빛을 받는 부분 중 지구에서 보이는 범위가 달라진다","지구 그림자가 매일 달을 가린다","달 자체의 모양이 바뀐다","아직 모르겠다"]'::jsonb,'D18'),
 ('D12','["커진다","작아진다","변하지 않는다","아직 모르겠다"]'::jsonb,'D19'),
 ('D13','["수증기가 되어 공기 중으로 이동한다","물질 자체가 없어진다","옷 속에서 고체로 변한다","아직 모르겠다"]'::jsonb,'D20'),
 ('D14','["55g","50g","5g","아직 모르겠다"]'::jsonb,null),
 ('D15','["계속 켜져요","반드시 꺼져요","전류가 두 배가 돼요","아직 모르겠다"]'::jsonb,null),
 ('D16','["같은 온도예요","금속이 반드시 더 낮아요","나무가 반드시 더 낮아요","아직 모르겠다"]'::jsonb,null),
 ('D17','["둘 다 일어날 수 있어요","광합성만 일어나요","호흡만 일어나요","아직 모르겠다"]'::jsonb,null),
 ('D18','["월식은 지구 그림자 때문이고 평소 위상 변화는 보는 방향 때문이에요","둘 다 항상 지구 그림자 때문이에요","둘 다 달이 빛을 내기 때문이에요","아직 모르겠다"]'::jsonb,null),
 ('D19','["작아져요","커져요","항상 같아요","아직 모르겠다"]'::jsonb,null),
 ('D20','["같아요","줄어들어요","늘어나요","아직 모르겠다"]'::jsonb,null);

-- Keep the mature state transitions; remove the original entry point from the exposed schema.
alter function public.lab_act(text,uuid,integer,jsonb,uuid) rename to lab_act_v1_impl;
alter function public.lab_act_v1_impl(text,uuid,integer,jsonb,uuid) set schema private;
revoke all on function private.lab_act_v1_impl(text,uuid,integer,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.lab_act(p_action text,p_id uuid,p_version integer,p_data jsonb,p_request uuid)
 returns uuid language plpgsql security definer set search_path='' as $$
declare m public.lab_members; r public.lab_records; catalog private.lab_content_contract;
begin
 select * into m from public.lab_members where user_id=auth.uid();
 if m.user_id is null then raise exception 'unauthorized';end if;
 if p_action is null or p_request is null or coalesce(jsonb_typeof(p_data),'null')<>'object' or octet_length(p_data::text)>131072 then raise exception 'invalid_input';end if;
 perform pg_advisory_xact_lock(hashtextextended(m.user_id::text,505));
 if p_action='submit' then
  select * into catalog from private.lab_content_contract where id=p_data->>'item' and transfer_id is not null;
  if not found or coalesce(jsonb_typeof(p_data->'prediction'),'null')<>'string' or not(catalog.choices ? (p_data->>'prediction')) then raise exception 'invalid_input';end if;
 elsif p_action='reassess' then
  select * into r from public.lab_records where id=p_id;
  if not found or not exists(select 1 from public.lab_members s where s.user_id=r.student_id and s.class_id=m.class_id) or (m.role='student' and r.student_id<>m.user_id) then raise exception 'not_found';end if;
  select c.* into catalog from private.lab_content_contract original join private.lab_content_contract c on c.id=original.transfer_id where original.id=r.item_id;
  if not found or coalesce(jsonb_typeof(p_data->'prediction'),'null')<>'string' or not(catalog.choices ? (p_data->>'prediction')) then raise exception 'invalid_input';end if;
 end if;
 return private.lab_act_v1_impl(p_action,p_id,p_version,p_data,p_request);
end $$;
revoke all on function public.lab_act(text,uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.lab_act(text,uuid,integer,jsonb,uuid) to authenticated;
