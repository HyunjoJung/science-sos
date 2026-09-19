import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db, configured } from '@/lib/supabase';
import { authError } from '@/lib/server/api-http';
import { AppError, readJson, requireOrigin, rpcError, publicFailure } from '@/lib/runtime/http.mjs';
const commandSchema=z.object({action:z.enum(['create_course','join_course','publish_assignment','submit','request_clarification','confirm_understanding','assign_activity','resubmit','complete_activity','submit_transfer','complete','material_add','material_edit','chat_send','remove_student','retry_job','invite']),
 id:z.uuid().nullable(),version:z.number().int().positive().nullable(),request:z.uuid(),data:z.record(z.string(),z.unknown())}).strict();
const response=(value:unknown,requestId:string,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Request-Id':requestId,...headers}});
function failure(error:unknown,id:string){
 const value=publicFailure(error instanceof z.ZodError?new AppError('invalid_input',422,'입력 형식과 길이를 확인해 주세요.'):error,id);
 if(value.status>=500)console.error(JSON.stringify({event:'learning_api_failure',requestId:id,code:value.body.code}));
 return response(value.body,id,value.status,value.headers);
}
async function session(){
 if(!configured())throw new AppError('not_configured',503,'데이터베이스 연결을 준비하고 있어요.');
 const client=await db(),{data:{user},error}=await client.auth.getUser();
 if(error){const e=authError(error);if(e.status!==401)throw new AppError('auth_unavailable',503,'인증 연결이 원활하지 않아요.');}
 return {client,user};
}
export async function GET(req:NextRequest){
 const id=crypto.randomUUID();
 try{
  const {client,user}=await session();
  if(!user)return response({user_id:null,courses:[]},id);
  const course=req.nextUrl.searchParams.get('course'),before=req.nextUrl.searchParams.get('before'),beforeId=req.nextUrl.searchParams.get('before_id');
  if(course)z.uuid().parse(course);if(before)z.iso.datetime({offset:true}).parse(before);if(beforeId)z.uuid().parse(beforeId);
  const {data,error}=await client.rpc('learning_snapshot',{p_course:course,p_before:before,p_before_id:beforeId}).abortSignal(AbortSignal.timeout(12000));
  if(error){if(error.code==='PGRST202')throw new AppError('migration_required',503,'학습 교실 데이터 이전을 준비하고 있어요. 기존 교실은 계속 이용할 수 있어요.');throw rpcError(error);}
  if(!data||data.user_id!==user.id)throw new AppError('session_changed',401,'계정이 변경됐어요. 다시 로그인해 주세요.');
  return response(data,id);
 }catch(error){return failure(error,id);}
}
export async function POST(req:NextRequest){
 const id=crypto.randomUUID();
 try{
  requireOrigin(req,req.nextUrl.origin,process.env.APP_ORIGIN);
  const {client,user}=await session();if(!user)throw new AppError('unauthorized',401,'로그인해 주세요.');
  if(req.headers.get('x-science-actor')!==user.id)throw new AppError('session_changed',401,'계정이 변경됐어요. 새로고침 후 다시 확인해 주세요.');
  const command=commandSchema.parse(await readJson(req));
  const {course_id:course,...data}=command.data;
  const courseId=z.uuid().nullable().parse(course??null);
  if(command.action==='invite'){
   if(!courseId)throw new AppError('invalid_input',422,'수업을 선택해 주세요.');
   const {data:value,error}=await client.rpc('learning_invite',{p_course:courseId,p_request:command.request}).abortSignal(AbortSignal.timeout(12000));
   if(error)throw rpcError(error);
   return response({id:courseId,...value},id);
  }
  const {data:value,error}=await client.rpc('learning_command',{p_action:command.action,p_course:courseId,p_id:command.id,p_version:command.version,p_data:data,p_request:command.request}).abortSignal(AbortSignal.timeout(12000));
  if(error)throw rpcError(error);
  if(typeof value!=='string')throw new AppError('unconfirmed',503,'저장 결과를 확인하지 못했어요. 같은 내용으로 다시 확인해 주세요.');
  return response({id:value},id);
 }catch(error){return failure(error,id);}
}
