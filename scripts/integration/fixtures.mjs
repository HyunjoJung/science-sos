import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
if(!process.env.TEST_DATABASE_URL || !process.env.TEST_DATABASE_URL.includes('localhost'))throw Error('Only disposable local TEST_DATABASE_URL allowed');
export const users={teacher:'10000000-0000-4000-8000-000000000001',student:'10000000-0000-4000-8000-000000000002',other:'10000000-0000-4000-8000-000000000003',outsider:'10000000-0000-4000-8000-000000000004'};
export const literal=v=>v===null?'NULL':`'${String(v).replaceAll("'","''")}'`;
export function sql(statement){return execFileSync('psql',[process.env.TEST_DATABASE_URL,'-X','-v','ON_ERROR_STOP=1','-Atq','-c',statement],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
export function asUser(user,statement){return sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub',${literal(user)},true); ${statement}; commit;`).split('\n').slice(1).join('\n');}
export const packs=JSON.parse(readFileSync(new URL('../../content/learning-packs.json',import.meta.url)));
export function fixture(){
 sql(`truncate private.learning_events,private.learning_requests,private.learning_jobs,private.learning_attempts,private.learning_assignments,private.learning_budget,private.learning_enrolments,private.learning_courses cascade;`);
 for(const [key,id] of Object.entries(users))sql(`insert into auth.users values(${literal(id)}) on conflict do nothing;`);
 const c1=sql(`insert into private.learning_courses(title) values('검증 교실 A') returning id`);
 const c2=sql(`insert into private.learning_courses(title) values('검증 교실 B') returning id`);
 for(const key of ['teacher','student','other'])sql(`insert into private.learning_enrolments values(${literal(c1)},${literal(users[key])},${literal(key==='teacher'?'teacher':'student')},true)`);
 sql(`insert into private.learning_enrolments values(${literal(c2)},${literal(users.outsider)},'student',true)`);
 for(const p of packs)sql(`select public.learning_register_pack(${literal(JSON.stringify(p))}::jsonb)`);
 return {c1,c2};
}
export function act(user,action,id,version,data,request=crypto.randomUUID()){
 return asUser(user,`select public.learning_act(${literal(action)},${literal(id)}::uuid,${version??'null'},${literal(JSON.stringify(data))}::jsonb,${literal(request)}::uuid)`);
}
export function list(user,course){return JSON.parse(asUser(user,`select public.learning_list(${literal(course)}::uuid)`));}
export function claim(){return JSON.parse(sql('select coalesce(public.learning_claim(),\'null\'::jsonb)'));}
export function finish(job,result,error=null,retry=false){return sql(`select public.learning_finish(${literal(job.id)}::uuid,${literal(job.lease)}::uuid,${literal(result===null?null:JSON.stringify(result))}::jsonb,${literal(error)},${retry})`);}
