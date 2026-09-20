import test from 'node:test';import assert from 'node:assert/strict';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createPublicMcpHandler} from '../../src/lib/mcp/public-server.mjs';
const origin='https://school.example',url=origin+'/api/mcp';
function req(body,headers={},method='POST'){return new Request(url,{method,headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});}
const handle=createPublicMcpHandler({enabled:true,origin});
for(const mode of ['legacy','auto'])test(`official SDK ${mode} discovery, tools, resource and prompt`,async()=>{
 const c=new Client({name:'protocol-test',version:'1.0.0'},{versionNegotiation:{mode}});
 const transport=new StreamableHTTPClientTransport(new URL(url),{fetch:async(u,o)=>handle(new Request(u,o))});
 try{
  await c.connect(transport);const tools=(await c.listTools()).tools;
  assert.deepEqual(tools.map(t=>t.name).sort(),['get_learning_resource','list_learning_topics','search_learning_resources']);
  assert.ok(tools.every(t=>t.annotations?.readOnlyHint&&t.annotations?.destructiveHint===false));
  const result=await c.callTool({name:'search_learning_resources',arguments:{subject:'science',topic:'density'}});assert.equal(result.structuredContent.resources[0].id,'phet-buoyancy');
  const r=await c.callTool({name:'get_learning_resource',arguments:{resource_id:'ebs-math'}});assert.equal(r.structuredContent.resource.provider,'EBS');
  const topics=await c.callTool({name:'list_learning_topics',arguments:{}});assert.equal(topics.structuredContent.privateData,false);
  const resource=await c.readResource({uri:'learning-sos://catalog/info'});assert.equal(JSON.parse(resource.contents[0].text).privateData,false);
  const prompt=await c.getPrompt({name:'teacher_resource_review',arguments:{resource_id:'ebs-math'}});assert.ok(prompt.messages[0].content.text.includes('automaticApproval'));
  const bad=await c.callTool({name:'get_learning_resource',arguments:{resource_id:'unknown'}});assert.equal(bad.isError,true);
  const privateRead=await c.callTool({name:'get_student_answers',arguments:{}}).catch(e=>e);assert.ok(privateRead.isError||privateRead instanceof Error);
  const extra=await c.callTool({name:'search_learning_resources',arguments:{subject:'science',topic:'density',student_id:'private'}}).catch(e=>e);assert.ok(extra.isError||extra instanceof Error);
 }finally{await c.close();}
});
test('disabled endpoint is not accidentally exposed',async()=>assert.equal((await createPublicMcpHandler({origin})(req({}))).status,404));
for(const bad of [undefined,'not-a-url','https://u:p@school.example','https://school.example/path'])test('invalid configured origin fails closed '+bad,async()=>assert.equal((await createPublicMcpHandler({enabled:true,origin:bad})(req({}))).status,503));
for(const given of ['null','https://evil.invalid','https://school.example.evil.invalid','http://school.example'])test('hostile Origin denied '+given,async()=>{const r=await handle(req({},{origin:given}));assert.equal(r.status,403);assert.equal(r.headers.has('access-control-allow-origin'),false);});
test('same origin OPTIONS has exact CORS and no credentials flag',async()=>{const r=await handle(req(undefined,{origin},'OPTIONS'));assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),origin);assert.equal(r.headers.get('access-control-allow-credentials'),null);});
for(const method of ['GET','DELETE'])test('stateless endpoint declines '+method,async()=>assert.equal((await handle(req(undefined,{},method))).status,405));
test('malformed JSON, arrays and oversized body rejected',async()=>{assert.equal((await handle(req('{'))).status,400);assert.equal((await handle(req([]))).status,400);assert.equal((await handle(req({data:'가'.repeat(6000)}))).status,413);});
test('inbound credentials and forwarded host are stripped before SDK',async()=>{let forwarded;const h=createPublicMcpHandler({enabled:true,origin,handler:async r=>{forwarded=r;return Response.json({});}});const r=await h(req({},{authorization:'Bearer secret',cookie:'session=private','x-forwarded-host':'evil.invalid'}));assert.equal(r.status,200);for(const k of ['authorization','cookie','x-forwarded-host'])assert.equal(forwarded.headers.get(k),null);assert.equal(forwarded.url,url);assert.equal(r.headers.get('cache-control'),'no-store');});
test('per-instance concurrency stays bounded',async()=>{let release;const gate=new Promise(r=>release=r);const h=createPublicMcpHandler({enabled:true,origin,handler:async()=>{await gate;return Response.json({});}});const requests=Array.from({length:16},()=>h(req({})));await new Promise(r=>setTimeout(r,5));const busy=await h(req({}));assert.equal(busy.status,429);release();await Promise.all(requests);assert.equal((await h(req({}))).status,200);});
