create table public.lab_materials(id uuid primary key default gen_random_uuid(),class_id text not null,owner uuid not null references public.lab_members(user_id),title text not null,section text not null default '',content text not null check(length(content) between 1 and 30000),enabled boolean not null default true,created_at timestamptz default now());
create table public.lab_feedback(id uuid primary key default gen_random_uuid(),class_id text not null,teacher_id uuid not null references public.lab_members(user_id),student_id uuid not null references public.lab_members(user_id),record_id uuid references public.lab_records(id),body text not null check(length(body) between 1 and 1500),read_at timestamptz,created_at timestamptz default now());
create table public.lab_chats(id uuid primary key default gen_random_uuid(),class_id text not null,student_id uuid not null references public.lab_members(user_id),room text not null check(room in ('course','external')),question text not null check(length(question) between 1 and 500),answer text,sources jsonb not null default '[]',status text not null default 'pending' check(status in ('pending','processing','ready','error')),lease uuid,expires_at timestamptz,created_at timestamptz default now());
create table public.lab_topics(id uuid primary key default gen_random_uuid(),class_id text not null,author uuid not null references public.lab_members(user_id),title text not null check(length(title) between 1 and 180),unit text not null,created_at timestamptz default now());
create table public.lab_posts(id uuid primary key default gen_random_uuid(),topic_id uuid not null references public.lab_topics(id),author uuid not null references public.lab_members(user_id),parent_id uuid references public.lab_posts(id),body text not null check(length(body) between 1 and 1500),created_at timestamptz default now());
create table public.lab_likes(post_id uuid references public.lab_posts(id),user_id uuid references public.lab_members(user_id),primary key(post_id,user_id));
alter table public.lab_materials enable row level security;
alter table public.lab_feedback enable row level security;
alter table public.lab_chats enable row level security;
alter table public.lab_topics enable row level security;
alter table public.lab_posts enable row level security;
alter table public.lab_likes enable row level security;
revoke all on public.lab_materials,public.lab_feedback,public.lab_chats,public.lab_topics,public.lab_posts,public.lab_likes from anon,authenticated;
grant all on public.lab_materials,public.lab_feedback,public.lab_chats,public.lab_topics,public.lab_posts,public.lab_likes to service_role;
create index on public.lab_chats(class_id,student_id);
create index on public.lab_feedback(class_id,student_id);
create index on public.lab_materials(class_id);
create index on public.lab_topics(class_id);
create index on public.lab_posts(topic_id);

create function public.lab_space() returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lab_members;out_data jsonb;
begin
 select * into m from public.lab_members where user_id=auth.uid();if m.user_id is null then raise exception 'unauthorized';end if;
 return jsonb_build_object(
 'members',case when m.role='teacher' then (select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'alias',alias)),'[]') from public.lab_members where class_id=m.class_id and role='student') else '[]'::jsonb end,
 'materials',(select coalesce(jsonb_agg(to_jsonb(x)-'owner'-'class_id' order by created_at desc),'[]') from public.lab_materials x where class_id=m.class_id and (m.role='teacher' or enabled)),
 'feedback',(select coalesce(jsonb_agg(to_jsonb(x)-'class_id' order by created_at desc),'[]') from public.lab_feedback x where class_id=m.class_id and (m.role='teacher' or student_id=m.user_id)),
 'chats',(select coalesce(jsonb_agg(to_jsonb(x)-'lease'-'expires_at'-'class_id' order by created_at),'[]') from public.lab_chats x where class_id=m.class_id and (m.role='teacher' or student_id=m.user_id)),
 'topics',(select coalesce(jsonb_agg(to_jsonb(x)-'class_id' order by created_at desc),'[]') from public.lab_topics x where class_id=m.class_id),
 'posts',(select coalesce(jsonb_agg((to_jsonb(p)-'author')||jsonb_build_object('author',case when s.role='teacher' then '선생님' else s.alias end,'mine',p.author=m.user_id,'is_teacher',s.role='teacher','likes',(select count(*) from public.lab_likes where post_id=p.id),'liked',exists(select 1 from public.lab_likes where post_id=p.id and user_id=m.user_id)) order by p.created_at),'[]') from public.lab_posts p join public.lab_topics t on t.id=p.topic_id join public.lab_members s on s.user_id=p.author where t.class_id=m.class_id));
end $$;

create function public.lab_space_act(p_action text,p_id uuid,p_data jsonb,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare m public.lab_members;out_id uuid; prior private.lab_requests;target uuid; topic public.lab_topics; post public.lab_posts;
begin
 select * into m from public.lab_members where user_id=auth.uid();if m.user_id is null then raise exception 'unauthorized';end if;
 if p_request is null or p_data is null then raise exception 'invalid_input';end if;
 perform pg_advisory_xact_lock(hashtextextended(m.user_id::text||p_request::text,0));
 select * into prior from private.lab_requests where actor=m.user_id and request_id=p_request;
 if found then if prior.payload<>jsonb_build_object('action',p_action,'id',p_id,'data',p_data) then raise exception 'idempotency_conflict';end if;return prior.result_id;end if;
 if p_action='material_add' then
  if m.role<>'teacher' or length(trim(coalesce(p_data->>'title',''))) not between 1 and 120 or length(coalesce(p_data->>'section',''))>100 then raise exception 'invalid_input';end if;
  if (select count(*) from public.lab_materials where class_id=m.class_id)>=50 then raise exception 'material_limit';end if;
  insert into public.lab_materials(class_id,owner,title,section,content) values(m.class_id,m.user_id,trim(p_data->>'title'),coalesce(p_data->>'section',''),trim(p_data->>'content')) returning id into out_id;
 elsif p_action='material_edit' then
  if m.role<>'teacher' then raise exception 'forbidden';end if;
  update public.lab_materials set content=coalesce(p_data->>'content',content),enabled=coalesce((p_data->>'enabled')::boolean,enabled) where id=p_id and class_id=m.class_id returning id into out_id;
 elsif p_action='feedback_send' then
  target:=(p_data->>'student_id')::uuid;
  if m.role<>'teacher' or not exists(select 1 from public.lab_members where user_id=target and role='student' and class_id=m.class_id) then raise exception 'forbidden';end if;
  if p_id is not null and not exists(select 1 from public.lab_records where id=p_id and student_id=target) then raise exception 'not_found';end if;
  insert into public.lab_feedback(class_id,teacher_id,student_id,record_id,body) values(m.class_id,m.user_id,target,p_id,trim(p_data->>'body')) returning id into out_id;
 elsif p_action='feedback_read' then
  update public.lab_feedback set read_at=coalesce(read_at,now()) where id=p_id and student_id=m.user_id returning id into out_id;
 elsif p_action='chat_send' then
  if m.role<>'student' then raise exception 'forbidden';end if;
  perform pg_advisory_xact_lock(hashtextextended(m.user_id::text,10));
  if (select count(*) from public.lab_chats where student_id=m.user_id and created_at>now()-interval '1 hour')>=20 then raise exception 'rate_limit';end if;
  insert into public.lab_chats(class_id,student_id,room,question) values(m.class_id,m.user_id,p_data->>'room',trim(p_data->>'question')) returning id into out_id;
 elsif p_action='topic_add' then
  if length(trim(coalesce(p_data->>'unit',''))) not between 1 and 80 then raise exception 'invalid_input';end if;
  if (select count(*) from public.lab_topics where author=m.user_id and created_at>now()-interval '1 hour')>=10 then raise exception 'rate_limit';end if;
  insert into public.lab_topics(class_id,author,title,unit) values(m.class_id,m.user_id,trim(p_data->>'title'),p_data->>'unit') returning id into out_id;
 elsif p_action='post_add' then
  select * into topic from public.lab_topics where id=p_id and class_id=m.class_id;if not found then raise exception 'not_found';end if;
  target:=(p_data->>'parent_id')::uuid;
  if target is not null and not exists(select 1 from public.lab_posts where id=target and topic_id=p_id and parent_id is null) then raise exception 'invalid_parent';end if;
  if (select count(*) from public.lab_posts where author=m.user_id and created_at>now()-interval '1 minute')>=10 then raise exception 'rate_limit';end if;
  insert into public.lab_posts(topic_id,author,parent_id,body) values(p_id,m.user_id,target,trim(p_data->>'body')) returning id into out_id;
 elsif p_action='like_toggle' then
  if not exists(select 1 from public.lab_posts p join public.lab_topics t on t.id=p.topic_id where p.id=p_id and t.class_id=m.class_id) then raise exception 'not_found';end if;
  perform pg_advisory_xact_lock(hashtextextended(m.user_id::text||p_id::text,11));
  if exists(select 1 from public.lab_likes where post_id=p_id and user_id=m.user_id) then delete from public.lab_likes where post_id=p_id and user_id=m.user_id;else insert into public.lab_likes values(p_id,m.user_id);end if;out_id:=p_id;
 else raise exception 'invalid_action';end if;
 if out_id is null then raise exception 'not_found';end if;
 insert into private.lab_requests values(m.user_id,p_request,out_id,jsonb_build_object('action',p_action,'id',p_id,'data',p_data));return out_id;
end $$;

create function public.lab_chat_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.lab_chats;n int;t uuid:=gen_random_uuid();
begin
 select * into c from public.lab_chats where status='pending' or (status='processing' and expires_at<now()) order by created_at for update skip locked limit 1;
 if c.id is null then return null;end if;
 insert into private.lab_ai_budget values(current_date,1) on conflict(day) do update set calls=private.lab_ai_budget.calls+1 returning calls into n;if n>100 then raise exception 'rate_limit';end if;
 update public.lab_chats set status='processing',lease=t,expires_at=now()+interval '90 seconds' where id=c.id;
 return to_jsonb(c)||jsonb_build_object('lease',t,'materials',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'section',section,'content',content)),'[]') from public.lab_materials where class_id=c.class_id and enabled));
end $$;
create function public.lab_chat_finish(p_id uuid,p_lease uuid,p_answer text,p_sources jsonb,p_status text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('ready','error') or length(p_answer) not between 1 and 4000 or jsonb_typeof(p_sources)<>'array' then raise exception 'invalid_input';end if;
 update public.lab_chats set answer=p_answer,sources=p_sources,status=p_status,lease=null,expires_at=null where id=p_id and lease=p_lease and status='processing';return found;
end $$;
revoke all on function public.lab_space(),public.lab_space_act(text,uuid,jsonb,uuid),public.lab_chat_claim(),public.lab_chat_finish(uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.lab_space(),public.lab_space_act(text,uuid,jsonb,uuid) to authenticated;
grant execute on function public.lab_chat_claim(),public.lab_chat_finish(uuid,uuid,text,jsonb,text) to service_role;
