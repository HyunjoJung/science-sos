import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { CATALOG_VERSION, searchResources, topicForPack, validateResourceResult, ResourceError } from './catalog.mjs';

/** This connector targets OUR public catalog only, not arbitrary model-selected MCP servers.
 * Every request is credential-free, bounded, and restricted to a single configured URL.
 */
export function resourceConfig(env) {
  const mode=env.LEARNING_RESOURCE_MODE||'local';
  if(!['local','mcp','off'].includes(mode))throw new ResourceError('resource_configuration');
  if(mode!=='mcp')return Object.freeze({mode});
  let origin;try{origin=new URL(env.APP_ORIGIN);}catch{throw new ResourceError('resource_configuration');}
  const loopback=['localhost','127.0.0.1','[::1]'].includes(origin.hostname);
  if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/' ||
    (origin.protocol!=='https:' && !(loopback&&origin.protocol==='http:'&&env.LEARNING_ALLOW_LOCAL_MCP==='true')) ||
    (loopback&&env.LEARNING_ALLOW_LOCAL_MCP!=='true'))throw new ResourceError('resource_configuration');
  return Object.freeze({mode,endpoint:new URL('/api/mcp',origin).href});
}

export function boundedMcpFetch(endpoint,signal,fetchFn=fetch) {
  return async(input,init={})=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    if(url.href!==endpoint)throw new ResourceError('mcp_target_denied');
    const headers=new Headers();
    for(const [k,v] of new Headers(init.headers))if(k==='accept'||k==='content-type'||k.startsWith('mcp-'))headers.set(k,v);
    const response=await fetchFn(url,{...init,headers,credentials:'omit',redirect:'error',cache:'no-store',signal:init.signal?AbortSignal.any([signal,init.signal]):signal});
    if(!response.body)return response;
    const reader=response.body.getReader();const chunks=[];let size=0;
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>64*1024)throw new ResourceError('mcp_response_limit');chunks.push(value);}
    }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const safe=new Headers(response.headers);safe.delete('content-length');safe.delete('content-encoding');
    return new Response(bytes,{status:response.status,statusText:response.statusText,headers:safe});
  };
}

/** No keys, classroom IDs, names, answers, question strings, or arbitrary URLs enter this API. */
export function createResourceLookup(env,{fetchFn=fetch,timeoutMs=4000}={}) {
  const config=resourceConfig(env);
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>8000)throw new ResourceError('resource_configuration');
  return async function lookup(pack,signal) {
    const args=topicForPack({id:pack.id,subject:pack.subject});
    const base={catalogVersion:CATALOG_VERSION,tool:'search_learning_resources',transport:config.mode,arguments:args};
    if(config.mode==='off'||!args)return {...base,status:config.mode==='off'?'disabled':'unsupported',candidates:[]};
    if(signal?.aborted)return {...base,status:'cancelled',candidates:[]};
    if(config.mode==='local')return {...base,status:'ok',candidates:validateResourceResult(searchResources(args),args)};
    const controller=new AbortController();const abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeoutMs);
    const client=new Client({name:'learning-sos-resource-worker',version:'1.0.0'},{capabilities:{},versionNegotiation:{mode:'auto',probe:{timeoutMs,maxRetries:0}}});
    const transport=new StreamableHTTPClientTransport(new URL(config.endpoint),{fetch:boundedMcpFetch(config.endpoint,controller.signal,fetchFn),reconnectionOptions:{maxRetries:0}});
    try{
      await client.connect(transport,{timeout:timeoutMs,signal:controller.signal});
      const result=await client.callTool({name:'search_learning_resources',arguments:args},{timeout:timeoutMs,signal:controller.signal});
      if(result.isError)throw new ResourceError('mcp_tool_error');
      return {...base,status:'ok',candidates:validateResourceResult(result.structuredContent,args)};
    }catch{return {...base,status:signal?.aborted?'cancelled':'unavailable',candidates:[]};}
    finally{controller.abort();clearTimeout(timer);signal?.removeEventListener('abort',abort);await client.close().catch(()=>{});}
  };
}

/** One Gateway inference per attempt remains unchanged. Resource navigation is a separate
 * deterministic tool step and must NEVER become additional grading evidence or an approval.
 * Unavailability of optional MCP resources cannot discard a valid analysis.
 */
export function withLearningResources(analyze,lookup) {
  return async(job,signal)=>{
    const result=await analyze(job,signal);
    let resources;
    try{resources=await lookup({id:job.pack.id,subject:job.pack.subject},signal);}
    catch{resources={catalogVersion:CATALOG_VERSION,tool:'search_learning_resources',transport:'unknown',arguments:null,status:'unavailable',candidates:[]};}
    return {...result,resourceLookup:resources};
  };
}
