import type { NextRequest } from 'next/server';
import { db, configured } from '@/lib/supabase';
import { z } from 'zod';
import { AppError, publicFailure, readJson, requireOrigin, rpcError } from '@/lib/runtime/http.mjs';

const command=z.object({action:z.enum(['activate_pack','submit','request_clarification','resubmit','assign_activity','confirm_understanding','complete_activity','submit_transfer','complete','share_resource','revoke_resource']),
 id:z.uuid(),version:z.number().int().positive().nullable(),request:z.uuid(),data:z.record(z.string(),z.unknown())});
const reply=(data:unknown,id:string,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Request-Id':id,...headers}});
function fail(error:unknown,id:string){
 const failure=publicFailure(error instanceof z.ZodError?new AppError('invalid_input',422,'입력 내용을 확인해 주세요.'):error,id);
 if(failure.status>=500)console.error(JSON.stringify({event:'learning_api_failure',id,code:failure.body.code}));
 return reply(failure.body,id,failure.status,failure.headers);
}
async function session(){
 if(!configured())throw new AppError('configuration',503,'수업 연결 설정이 필요해요.');
 const s=await db();const {data:{user},error}=await s.auth.getUser();
 if(error && ![400,401,403].includes(error.status??0) && error.name!=='AuthSessionMissingError')throw new AppError('auth_unavailable',503,'로그인 연결이 원활하지 않아요.');
 if(!user)throw new AppError('unauthorized',401,'로그인해 주세요.');
 return s;
}
export async function GET(req:NextRequest){
 const id=crypto.randomUUID();
 try{
  const s=await session();const course=req.nextUrl.searchParams.get('course');
  let result;
  if(course){
   z.uuid().parse(course);
   const before=req.nextUrl.searchParams.get('before'),beforeId=req.nextUrl.searchParams.get('before_id');
   if(before){z.iso.datetime({offset:true}).parse(before);z.uuid().parse(beforeId);}
   if(!before && beforeId)throw new AppError('invalid_input',422,'페이지 정보를 확인해 주세요.');
   result=await s.rpc('learning_list',{p_course:course,p_before:before,p_before_id:beforeId});
  }else result=await s.rpc('learning_home');
  if(result.error)throw rpcError(result.error);
  if(!result.data)throw new AppError('database_unavailable',503,'수업 연결이 원활하지 않아요.');
  return reply(result.data,id);
 }catch(error){return fail(error,id);}
}
export async function POST(req:NextRequest){
 const id=crypto.randomUUID();
 try{
  requireOrigin(req,req.nextUrl.origin,process.env.APP_ORIGIN);
  const s=await session();const v=command.parse(await readJson(req,{maxBytes:32*1024}));
  // Session RPC is authoritative for every action, including direct RPC callers and replayed requests.
  const {data,error}=await s.rpc(['share_resource','revoke_resource'].includes(v.action)?'learning_resource_act':'learning_act',{p_action:v.action,p_id:v.id,p_version:v.version,p_data:v.data,p_request:v.request});
  if(error)throw rpcError(error);
  if(typeof data!=='string')throw new AppError('database_unavailable',503,'저장 결과를 확인하지 못했어요.');
  return reply({id:data},id);
 }catch(error){return fail(error,id);}
}
