import { boundedJson } from '../src/lib/learning/agent.mjs';
/** Service role is held only by this server process, never the Next public bundle. */
export function createServiceRpc(env,fetchFn=fetch) {
 let url;try {url=new URL(env.NEXT_PUBLIC_SUPABASE_URL);}catch{throw Error('supabase_configuration');}
 if(url.protocol!=='https:' && !(env.LEARNING_ALLOW_LOCAL_DB==='true' && ['localhost','127.0.0.1'].includes(url.hostname)))throw Error('supabase_configuration');
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!env.SUPABASE_SECRET_KEY)throw Error('supabase_configuration');
 const allowed=new Set(['learning_claim','learning_finish','learning_register_pack']);
 return async(name,args)=>{
  if(!allowed.has(name))throw Error('rpc_not_allowed');
  const response=await fetchFn(new URL(`/rest/v1/rpc/${name}`,url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
   headers:{apikey:env.SUPABASE_SECRET_KEY,...(env.SUPABASE_SECRET_KEY.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${env.SUPABASE_SECRET_KEY}`}), 'Content-Type':'application/json'},body:JSON.stringify(args)});
  if(!response.ok){void response.body?.cancel().catch(()=>{});throw Error('rpc_failed');}
  return boundedJson(response,128*1024);
 };
}
