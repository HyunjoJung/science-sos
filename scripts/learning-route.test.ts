import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
const mocks = vi.hoisted(() => ({ configured: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), result: { data: null as unknown, error: null as unknown } }));
vi.mock('../src/lib/supabase', () => ({ configured: mocks.configured, db: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));
import { GET, POST } from '../src/app/api/learning/route';
const USER='22222222-2222-4222-8222-222222222222',COURSE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',TARGET='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',REQUEST='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const origin='https://school.example';
const command={action:'submit',id:TARGET,version:null,request:REQUEST,data:{course_id:COURSE,choice:'허용 보기',reason:'이유 원문'}};
function request(body:unknown=command,headers:Record<string,string>={}) { return new NextRequest(`${origin}/api/learning`,{method:'POST',headers:{'content-type':'application/json',origin,'x-science-actor':USER,...headers},body:JSON.stringify(body)}); }
beforeEach(()=>{
 vi.stubEnv('APP_ORIGIN',origin);vi.spyOn(console,'error').mockImplementation(()=>{});
 mocks.configured.mockReturnValue(true);mocks.getUser.mockResolvedValue({data:{user:{id:USER}},error:null});
 mocks.result={data:TARGET,error:null};mocks.rpc.mockReset();mocks.rpc.mockImplementation(()=>({abortSignal:()=>Promise.resolve(mocks.result)}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
it('POST arguments match the real six-argument SQL signature and preserve the request UUID',async()=>{
 const response=await POST(request());expect(response.status).toBe(200);
 const [name,args]=mocks.rpc.mock.calls[0];expect(name).toBe('learning_command');
 const sql=readFileSync(new URL('../supabase/migrations/006_learning_runtime.sql',import.meta.url),'utf8');
 const signature=sql.match(/create function public\.learning_command\(([^)]+)\)/)?.[1];expect(signature).toBeTruthy();
 const parameters=signature!.split(',').map(s=>s.trim().split(/\s/)[0]);
 expect(Object.keys(args).sort()).toEqual(parameters.sort());
 expect(args).toEqual({p_action:'submit',p_course:COURSE,p_id:TARGET,p_version:null,p_request:REQUEST,p_data:{choice:'허용 보기',reason:'이유 원문'}});
});
it('invite carries the same request UUID to its exact SQL contract',async()=>{
 mocks.result.data={token:'t'.repeat(64)};const response=await POST(request({...command,action:'invite'}));expect(response.status).toBe(200);
 expect(mocks.rpc).toHaveBeenCalledWith('learning_invite',{p_course:COURSE,p_request:REQUEST});
});
it('create-course without selected course is valid',async()=>{
 expect((await POST(request({...command,action:'create_course',id:null,data:{title:'새 교실'}}))).status).toBe(200);
 expect(mocks.rpc.mock.calls[0][1].p_course).toBeNull();
});
it('rejects changing account before a mutation',async()=>{expect((await POST(request(command,{'x-science-actor':TARGET}))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();});
it('rejects missing actor header',async()=>{expect((await POST(request(command,{'x-science-actor':''}))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();});
it('rejects cross-origin mutation',async()=>{expect((await POST(request(command,{origin:'https://other.example'}))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
it('rejects missing session',async()=>{mocks.getUser.mockResolvedValue({data:{user:null},error:null});expect((await POST(request())).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();});
for(const body of [{...command,action:'set_admin'},{...command,request:null},{...command,version:0},{...command,data:{course_id:'invalid'}},{...command,extra:'unexpected'}])it(`rejects invalid mutation ${JSON.stringify(body)}`,async()=>{expect((await POST(request(body))).status).toBe(422);expect(mocks.rpc).not.toHaveBeenCalled();});
it('limits body size before RPC',async()=>{expect((await POST(request({...command,data:{reason:'x'.repeat(150000)}}))).status).toBe(413);expect(mocks.rpc).not.toHaveBeenCalled();});
for(const [message,status] of [['version_conflict',409],['idempotency_conflict',409],['forbidden',403],['rate_limit',429],['invalid_input',422]])it(`maps RPC ${message}`,async()=>{mocks.result.error={message};expect((await POST(request())).status).toBe(status);});
it('does not expose database failure text',async()=>{mocks.result.error={message:'private_password_and_student_content'};const response=await POST(request());expect(response.status).toBe(500);expect(await response.text()).not.toContain('private_password');});
it('treats an empty mutation result as unconfirmed rather than successful',async()=>{mocks.result.data=null;expect((await POST(request())).status).toBe(503);});
it('GET returns a signed-out snapshot without a database read',async()=>{mocks.getUser.mockResolvedValue({data:{user:null},error:null});const response=await GET(new NextRequest(origin+'/api/learning'));expect(response.status).toBe(200);expect(await response.json()).toEqual({user_id:null,courses:[]});expect(mocks.rpc).not.toHaveBeenCalled();});
it('GET forwards course and pagination using the SQL contract',async()=>{mocks.result.data={user_id:USER,courses:[]};const response=await GET(new NextRequest(`${origin}/api/learning?course=${COURSE}&before=2026-09-20T00:00:00Z&before_id=${TARGET}`));expect(response.status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('learning_snapshot',{p_course:COURSE,p_before:'2026-09-20T00:00:00Z',p_before_id:TARGET});expect(response.headers.get('cache-control')).toBe('private, no-store');});
it('GET rejects a snapshot from a different account',async()=>{mocks.result.data={user_id:TARGET,courses:[]};expect((await GET(new NextRequest(origin+'/api/learning'))).status).toBe(401);});
it('GET distinguishes missing migration from permission errors',async()=>{mocks.result.error={code:'PGRST202'};const response=await GET(new NextRequest(origin+'/api/learning'));expect(response.status).toBe(503);expect((await response.json()).code).toBe('migration_required');});
it('GET has a controlled error when configuration is absent',async()=>{mocks.configured.mockReturnValue(false);expect((await GET(new NextRequest(origin+'/api/learning'))).status).toBe(503);});
it('GET auth outage is not disguised as signed out',async()=>{mocks.getUser.mockResolvedValue({data:{user:null},error:{status:503}});expect((await GET(new NextRequest(origin+'/api/learning'))).status).toBe(503);});
it('scope repair migration uses the actual command signature',()=>{const fix=readFileSync(new URL('../supabase/migrations/009_rpc_local_scope.sql',import.meta.url),'utf8');expect(fix).toContain('learning_command(text,uuid,uuid,integer,jsonb,uuid)');});
