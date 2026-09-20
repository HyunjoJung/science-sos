import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { CATALOG_VERSION, TOPICS, getResource, searchResources, ResourceError } from './catalog.mjs';
import { AppError, readJson } from '../runtime/http.mjs';

const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const output=data=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});
const info=()=>({catalogVersion:CATALOG_VERSION,topics:TOPICS,mode:'curated_directory',privateData:false,notice:'공개 링크 목록만 제공합니다. 실시간 웹 검색·외부 기관의 공식 MCP·수업 승인 API가 아닙니다.'});
const adapter=createMcpHandler(server=>{
  server.registerTool('list_learning_topics',{title:'지원 학습 주제',description:'공개 자료 목록이 지원하는 과목·주제 코드를 조회합니다. 학생 정보는 입력하지 않습니다.',inputSchema:z.object({}).strict(),annotations},async()=>output(info()));
  server.registerTool('search_learning_resources',{title:'학습자료 후보 찾기',description:'검토된 공식 링크 디렉터리에서 과목·주제별 자료 후보를 찾습니다. 실시간 웹 검색이 아니며, 교사가 검토하기 전에는 학생에게 배정하지 마세요.',inputSchema:z.object({subject:z.enum(['science','mathematics']),topic:z.enum(['density','fractions'])}).strict(),annotations},async args=>{
    try{return output(searchResources(args));}catch{return {...output({error:'invalid_arguments'}),isError:true};}
  });
  server.registerTool('get_learning_resource',{title:'학습자료 정보',description:'알려진 자료 ID의 공식 URL·언어·확인일을 반환합니다. URL 가져오기나 학생 답안 조회는 지원하지 않습니다.',inputSchema:z.object({resource_id:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)}).strict(),annotations},async({resource_id})=>{
    try{return output(getResource(resource_id));}catch(error){return {...output({error:error instanceof ResourceError?error.message:'unavailable'}),isError:true};}
  });
  server.registerResource('directory-info','learning-sos://catalog/info',{title:'공개 자료 디렉터리',mimeType:'application/json'},async uri=>({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(info())}]}));
  server.registerPrompt('teacher_resource_review',{title:'교사의 자료 검토',description:'공개 링크를 수업에 쓰기 전 검토할 질문을 제공합니다. 자동 배정하지 않습니다.',argsSchema:z.object({resource_id:z.string().max(64)})},async({resource_id})=>({messages:[{role:'user',content:{type:'text',text:JSON.stringify({resource:getResource(resource_id).resource,review:['현재 링크와 접근 조건을 확인하세요.','학년·언어·교육과정 범위에 맞는지 검토하세요.','학생에게 전달하려면 학습SOS 교사 화면에서 직접 승인하세요.'],automaticApproval:false})}}]}));
},{serverInfo:{name:'learning-sos-public-resources',version:'1.0.0'},verboseLogs:false,maxSubscriptions:0,instructions:'Public, bounded editorial directory only. Never send personal data. No student records, private curriculum, grading, approval, or arbitrary URL fetching tools.'});

/** Stateless public-only endpoint. Missing Origin is valid for machine clients;
 * present Origin must equal the operator-configured origin. No cookie auth or wildcard CORS.
 * @param {{enabled?:boolean,origin?:string,handler?:(r:Request)=>Promise<Response>}} options */
export function createPublicMcpHandler({enabled=false,origin,handler=adapter}={}) {
  let inFlight=0;
  return async function handle(request) {
    const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'});
    const reject=(status,message)=>Response.json({jsonrpc:'2.0',id:null,error:{code:-32000,message}},{status,headers});
    if(!enabled)return reject(404,'Not found');
    let expected;
    try{expected=new URL(origin);if(!['https:','http:'].includes(expected.protocol)||expected.username||expected.password||expected.search||expected.hash||expected.pathname!=='/')throw Error();}catch{return reject(503,'MCP configuration unavailable');}
    const given=request.headers.get('origin');
    if(given!==null&&given!==expected.origin)return reject(403,'Origin not allowed');
    if(given){headers.set('Access-Control-Allow-Origin',given);headers.set('Access-Control-Allow-Methods','POST, OPTIONS');headers.set('Access-Control-Allow-Headers','Content-Type, MCP-Protocol-Version, MCP-Method, MCP-Name');}
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST'){headers.set('Allow','POST, OPTIONS');return reject(405,'Method not allowed');}
    // Bounded per-instance concurrency is not a substitute for an edge/global rate limit.
    if(inFlight>=16){headers.set('Retry-After','2');return reject(429,'Busy');}
    inFlight++;
    try{
      const body=await readJson(request,{maxBytes:16*1024,timeoutMs:5000});
      if(!body||typeof body!=='object'||Array.isArray(body))return reject(400,'Invalid JSON-RPC message');
      // The public adapter never receives bearer keys, login cookies or forwarded host claims.
      const safeHeaders=new Headers();
      for(const [key,value] of request.headers)if(key==='accept'||key==='content-type'||key==='origin'||key.startsWith('mcp-'))safeHeaders.set(key,value);
      const response=await handler(new Request(new URL('/api/mcp',expected),{method:'POST',headers:safeHeaders,body:JSON.stringify(body),signal:request.signal}));
      const combined=new Headers(response.headers);for(const [key,value] of headers)combined.set(key,value);
      return new Response(response.body,{status:response.status,headers:combined});
    }catch(error){return reject(error instanceof AppError?error.status:500,'MCP request rejected');}
    finally{inFlight--;}
  };
}
