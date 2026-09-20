// Test transport ONLY: fake Auth/model + real PostgreSQL RPCs. Never a production server.
import {createServer} from 'node:http';import {createHmac,timingSafeEqual} from 'node:crypto';
import {fixture,users,sql,literal} from './fixtures.mjs';
if(process.env.NODE_ENV!=='test')throw Error('test_only');
fixture();
const jwtSecret='ci-only-not-a-real-supabase-secret';const revoked=new Set();
const userObject=(id,email)=>({id,email,aud:'authenticated',role:'authenticated',created_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{}});
function sign(data){const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const body=Buffer.from(JSON.stringify(data)).toString('base64url');return head+'.'+body+'.'+createHmac('sha256',jwtSecret).update(head+'.'+body).digest('base64url');}
function verify(token){try{if(revoked.has(token))return null;const [a,b,c]=token.split('.');const expected=createHmac('sha256',jwtSecret).update(a+'.'+b).digest();const actual=Buffer.from(c,'base64url');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;const p=JSON.parse(Buffer.from(b,'base64url'));return p.exp>Date.now()/1000?p:null;}catch{return null;}}
const functions={
 trial_status:[['p_session_hash','text']],trial_enqueue:[['p_session_hash','text'],['p_ip_hash','text'],['p_request','uuid'],['p_prediction','text'],['p_reason','text']],
 learning_home:[],learning_list:[['p_course','uuid'],['p_before','timestamptz'],['p_before_id','uuid']],
 learning_resource_act:[['p_action','text'],['p_id','uuid'],['p_version','int'],['p_data','jsonb'],['p_request','uuid']],
 learning_act:[['p_action','text'],['p_id','uuid'],['p_version','int'],['p_data','jsonb'],['p_request','uuid']],
 learning_claim:[],learning_finish:[['p_job','uuid'],['p_lease','uuid'],['p_result','jsonb'],['p_error','text'],['p_retry','boolean']],learning_register_pack:[['p_pack','jsonb']],
};
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;let text='';
  for await(const part of req){text+=part;if(text.length>200_000){send(res,413,{});return;}}
  const data=text?JSON.parse(text):{};const token=(req.headers.authorization||'').replace(/^Bearer /,'');const user=verify(token);
  if(path==='/health'){send(res,200,{ok:true});return;}
  if(path==='/auth/v1/token'){
   const name=String(data.email||'').split('@')[0];const id=users[name];
   if(!id||data.password!=='ci-password-123'){send(res,400,{code:'invalid_credentials',msg:'invalid_credentials'});return;}
   const email=name+'@test.invalid';const claims={sub:id,email,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),session_id:crypto.randomUUID()};
   send(res,200,{access_token:sign(claims),refresh_token:crypto.randomUUID(),token_type:'bearer',expires_in:3600,expires_at:claims.exp,user:userObject(id,email)});return;
  }
  if(path==='/auth/v1/user'){send(res,user?200:401,user?userObject(user.sub,user.email):{code:'bad_jwt',msg:'bad_jwt'});return;}
  if(path==='/auth/v1/logout'){revoked.add(token);res.writeHead(204).end();return;}
  if(path==='/v1/chat/completions'){
   // Deterministic transport fixture, not a real model quality evaluation.
   const input=JSON.parse(data.messages.at(-1).content);const reason=input.response.reason;
   const content=JSON.stringify({interpretation:'understood',evidence:'supported',quote:reason,note:'CI fixture: 제공한 이유를 새 문항에서도 확인하세요.'});
   send(res,200,{choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});return;
  }
  const name=path.replace('/rest/v1/rpc/','');
  if(!path.startsWith('/rest/v1/rpc/')||!Object.hasOwn(functions,name)){send(res,404,{});return;}
  const service=req.headers.apikey==='sb_secret_ci_only';
  if(!service&&!user){send(res,401,{code:'bad_jwt',message:'unauthorized'});return;}
  const args=functions[name].map(([key,type])=>literal(data[key]==null?null:type==='jsonb'?JSON.stringify(data[key]):data[key])+'::'+type).join(',');
  try{
   const output=sql(`begin;set local role ${service?'service_role':'authenticated'};select set_config('request.jwt.claim.sub',${literal(user?.sub??'')},true);select coalesce(to_jsonb(public.${name}(${args})),'null'::jsonb);commit;`);
   send(res,200,JSON.parse(output.split('\n').at(-1)||'null'));
  }catch(e){const message=String(e.stderr||'').match(/ERROR:\s+([^\n]+)/)?.[1]||'database_error';send(res,400,{code:'P0001',message});}
 }catch{send(res,500,{code:'bridge_failure',message:'test_transport_failure'});}
}).listen(55321,'127.0.0.1',()=>console.log('Test Auth/RPC/model bridge ready; PostgreSQL is real, Auth and model are fixtures.'));
