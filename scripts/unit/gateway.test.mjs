import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentError,modelConfig,completionBody,createAnalyzer,workOnce,GATEWAY_ENDPOINT} from '../../src/lib/learning/agent.mjs';
import {checkGateway} from '../../src/lib/learning/gateway-check.mjs';
const env={AI_GATEWAY_API_KEY:'test-gateway-key',LEARNING_MODEL:'openai/gpt-oss-120b'};
const job={id:'synthetic-job',lease:'lease',pack:{id:'sample',version:'1.0.0',subject:'math',scope:'범위',prompt:'질문',rubric:'검토 기준',correctAnswer:'2'},response:{answer:'2',reason:'하나와 하나는 두 개예요.'}};
const valid={interpretation:'understood',evidence:'supported',quote:'하나와 하나',note:'새 문항으로 확인'};
const envelope=(extra={})=>Response.json({model:'openai/gpt-oss-120b',choices:[{finish_reason:'stop',message:{content:JSON.stringify(valid)}}],usage:{prompt_tokens:4,completion_tokens:5,total_tokens:9},...extra});

test('Gateway is default and uses only its dedicated API key',()=>{
 const c=modelConfig(env);assert.equal(c.provider,'vercel');assert.equal(c.endpoint,GATEWAY_ENDPOINT);assert.equal(c.key,env.AI_GATEWAY_API_KEY);assert.equal(c.privacy,'zdr');assert.equal(c.maxTokens,2048);assert.ok(Object.isFrozen(c));
});
for(const overrides of [{AI_GATEWAY_API_KEY:undefined},{LEARNING_MODEL:undefined},{LEARNING_MODEL:'gpt-oss-120b'},{LEARNING_MODEL_PROVIDER:'other'},{AI_GATEWAY_API_KEY:'key\nsecret'},{LEARNING_MODEL_ENDPOINT:'https://evil.example/v1/chat/completions'},{LEARNING_MODEL_ENDPOINT:'https://ai-gateway.vercel.sh.evil.example/v1/chat/completions'},{LEARNING_MODEL_ENDPOINT:GATEWAY_ENDPOINT+'?secret=yes'},{LEARNING_MODEL_API_KEY:'old-direct-key'},{LEARNING_GATEWAY_PRIVACY:'none'},{LEARNING_GATEWAY_PROVIDERS:'groq,groq'},{LEARNING_GATEWAY_PROVIDERS:'groq,,cerebras'},{LEARNING_GATEWAY_PROVIDERS:'https://example.test'},{LEARNING_MODEL_MAX_OUTPUT_TOKENS:'-1'},{LEARNING_MODEL_MAX_OUTPUT_TOKENS:'512.5'},{LEARNING_MODEL_MAX_OUTPUT_TOKENS:'8193'}])
 test(`invalid Gateway configuration fails closed: ${JSON.stringify(overrides)}`,()=>assert.throws(()=>modelConfig({...env,...overrides}),{code:'configuration'}));
test('a copied OIDC token is not an unattended worker API key',()=>assert.throws(()=>modelConfig({LEARNING_MODEL:env.LEARNING_MODEL,VERCEL_OIDC_TOKEN:'temporary-token'}),{code:'configuration'}));
test('custom endpoints must explicitly select compatible mode',()=>{
 const direct={LEARNING_MODEL_ENDPOINT:'http://localhost:9999/v1/chat/completions',LEARNING_MODEL:'fixture',LEARNING_MODEL_API_KEY:'fixture',LEARNING_ALLOW_LOCAL_MODEL:'true'};
 assert.throws(()=>modelConfig(direct));assert.equal(modelConfig({...direct,LEARNING_MODEL_PROVIDER:'compatible'}).provider,'compatible');
 assert.throws(()=>modelConfig({...direct,LEARNING_MODEL_PROVIDER:'compatible',AI_GATEWAY_API_KEY:'not-for-this-host'}));
});
test('strict schema includes every expected field and forbids extras',()=>{
 const b=completionBody(modelConfig(env),job);assert.equal(b.response_format.type,'json_schema');const s=b.response_format.json_schema;
 assert.equal(s.strict,true);assert.equal(s.schema.additionalProperties,false);assert.deepEqual(s.schema.required,['interpretation','evidence','quote','note']);
 assert.equal(b.stream,false);assert.equal(b.tools,undefined);assert.equal(b.models,undefined);assert.equal(b.providerOptions.gateway.models,undefined);
 assert.deepEqual(b.providerOptions.gateway,{disallowPromptTraining:true,zeroDataRetention:true});
});
test('free-account synthetic testing explicitly relaxes retention, never prompt training',()=>{
 const b=completionBody(modelConfig({...env,LEARNING_GATEWAY_PRIVACY:'synthetic'}),job);
 assert.equal(b.providerOptions.gateway.zeroDataRetention,false);assert.equal(b.providerOptions.gateway.disallowPromptTraining,true);
});
test('same-model provider allowlist is sent under Gateway extension',()=>{
 const c=modelConfig({...env,LEARNING_GATEWAY_PROVIDERS:'groq, cerebras'});assert.ok(Object.isFrozen(c.providers));
 assert.deepEqual(completionBody(c,job).providerOptions.gateway.only,['groq','cerebras']);
});
test('credentials go only to pinned HTTPS host; no redirects or metadata containing student identity',async()=>{
 let req;const result=await createAnalyzer(modelConfig(env),async(url,options)=>{req={url,...options};return envelope();})(job);
 assert.equal(req.url,GATEWAY_ENDPOINT);assert.equal(req.redirect,'error');assert.equal(req.headers.Authorization,'Bearer test-gateway-key');
 const body=JSON.parse(req.body);assert.equal(body.user,undefined);assert.equal(body.providerOptions.gateway.user,undefined);assert.equal(body.model,env.LEARNING_MODEL);
 assert.equal(result.gateway.provider,'vercel-ai-gateway');assert.equal(result.gateway.requestedPrivacy,'zdr');assert.equal(result.requestedModel,env.LEARNING_MODEL);
 assert.equal(result.proposal.kind,'transfer_check');assert.deepEqual(result.usage,{prompt_tokens:4,completion_tokens:5,total_tokens:9});
 assert.ok(!JSON.stringify(result).includes(env.AI_GATEWAY_API_KEY));
});
test('direct construction cannot redirect a Gateway credential',()=>assert.throws(()=>createAnalyzer({...modelConfig(env),endpoint:'https://evil.example'}),{code:'configuration'}));
test('upstream model identifier and requested Gateway slug remain distinct',async()=>{
 const r=await createAnalyzer(modelConfig(env),async()=>envelope({model:'gpt-oss-120b'}))(job);
 assert.equal(r.model,'gpt-oss-120b');assert.equal(r.requestedModel,'openai/gpt-oss-120b');
});
for(const [status,code,retry] of [[400,'provider_request',false],[401,'provider_auth',false],[402,'provider_credit',false],[403,'provider_auth',false],[404,'provider_request',false],[429,'provider_unavailable',true],[500,'provider_unavailable',true]])
 test(`HTTP ${status} is ${code}, retry=${retry}`,async()=>{
  let calls=0;await assert.rejects(createAnalyzer(modelConfig(env),async()=>{calls++;return new Response('secret upstream text',{status});})(job),e=>e instanceof AgentError&&e.code===code&&e.retryable===retry&&!e.message.includes('secret'));
  assert.equal(calls,1);
 });
test('provider/privacy exclusion is not retried with weaker controls',async()=>{
 let calls=0;await assert.rejects(createAnalyzer(modelConfig(env),async()=>{calls++;return Response.json({type:'no_providers_available',error:'private data'},{status:403});})(job),e=>e.code==='provider_policy'&&!e.retryable);assert.equal(calls,1);
});
test('strict output still rejects invented evidence',async()=>{
 await assert.rejects(createAnalyzer(modelConfig(env),async()=>envelope({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...valid,quote:'존재하지 않는 원문'})}}]}))(job),{code:'invalid_evidence'});
});
test('strict output still rejects unknown fields',async()=>{
 await assert.rejects(createAnalyzer(modelConfig(env),async()=>envelope({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...valid,grade:100})}}]}))(job),{code:'invalid_output'});
});
for(const message of [{refusal:'cannot help',content:JSON.stringify(valid)},{tool_calls:[{name:'anything'}],content:JSON.stringify(valid)}])
 test('refusal/tool call is never saved as an educational diagnosis',async()=>assert.rejects(createAnalyzer(modelConfig(env),async()=>envelope({choices:[{finish_reason:'stop',message}]}))(job),{code:'invalid_output'}));
test('credit failure is passed to durable job as terminal, not an error answer',async()=>{
 let saved;const status=await workOnce({rpc:async(name,args)=>{if(name==='learning_claim')return job;saved=args;return true;},analyze:async()=>{throw new AgentError('provider_credit');}});
 assert.equal(status,'failed_or_retrying');assert.equal(saved.p_error,'provider_credit');assert.equal(saved.p_retry,false);assert.equal(saved.p_result,null);
});
test('unknown database acknowledgement remains unconfirmed',async()=>assert.equal(await workOnce({rpc:async n=>n==='learning_claim'?job:null,analyze:async()=>valid}),'unconfirmed'));
test('cancelled worker does not claim a new job',async()=>{const c=new AbortController();c.abort();assert.equal(await workOnce({signal:c.signal,rpc:async()=>assert.fail(),analyze:async()=>assert.fail()}),'idle');});
test('cancelled inference never sends a request',async()=>{const c=new AbortController();c.abort();await assert.rejects(createAnalyzer(modelConfig(env),async()=>assert.fail())(job,c.signal),{code:'timeout'});});

test('preflight checks credits/catalog with GET only and never echoes raw metadata',async()=>{
 const calls=[];const report=await checkGateway(modelConfig(env),async(url,options)=>{calls.push({url,...options});return url.endsWith('/credits')?Response.json({balance:'5.00',total_used:'0',secret:'do not echo'}):Response.json({data:[{id:env.LEARNING_MODEL,type:'language',description:'do not echo',pricing:{input:'0.000001',output:'0.000002'}}]});});
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c.method==='GET'&&c.redirect==='error'&&!c.body));
 assert.equal(calls[0].headers.Authorization,'Bearer test-gateway-key');assert.equal(calls[1].headers.Authorization,undefined);
 assert.equal(report.creditBalanceUsd,'5.00');assert.equal(report.inferenceChecked,false);assert.ok(!JSON.stringify(report).includes('do not echo'));
});
test('preflight with no credits reports zero honestly, no inference or purchase',async()=>{
 const r=await checkGateway(modelConfig(env),async url=>url.endsWith('/credits')?Response.json({balance:'0'}):Response.json({data:[{id:env.LEARNING_MODEL}]}));assert.equal(r.creditBalanceUsd,'0');assert.equal(r.inferenceChecked,false);
});
for(const balance of [null,{},'NaN','Infinity'])test(`malformed preflight balance is not a free-credit claim: ${JSON.stringify(balance)}`,async()=>assert.rejects(checkGateway(modelConfig(env),async()=>Response.json({balance})),{code:'invalid_output'}));
test('preflight missing model is a configuration failure, no fallback model selection',async()=>assert.rejects(checkGateway(modelConfig(env),async url=>url.endsWith('/credits')?Response.json({balance:'5'}):Response.json({data:[]})),{code:'provider_request'}));
