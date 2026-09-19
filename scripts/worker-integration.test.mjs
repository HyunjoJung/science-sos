/** Real worker process + real local HTTP/TLS transport with simulated DB/model
 * services. No paid requests or hosted Supabase. PostgreSQL is tested separately.
 */
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer as httpServer} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
const temp=mkdtempSync(join(tmpdir(),'learning-worker-test-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1','-keyout',join(temp,'key.pem'),'-out',join(temp,'cert.pem')],{stdio:'ignore'});
after(()=>rmSync(temp,{recursive:true,force:true}));
const key=readFileSync(join(temp,'key.pem')),cert=readFileSync(join(temp,'cert.pem'));
const input={prompt:'비교하세요',choice:'정답',expected:'정답',reason:'같은 전체를 나누었어요',scope:'수업 자료',activities:[]};
const answer={interpretation:'understood',evidence:'같은 전체',note:'새 사례를 확인해 주세요.',activity_id:null};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){const end=Date.now()+10000;while(!check()){if(Date.now()>end)throw Error('Worker did not reach expected state');await pause(25);}}
async function listen(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return server.address().port;}
async function close(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>100000)throw Error('Test request too large');}return JSON.parse(text||'{}');}
async function run(t,{ackFailure=false,invalid=false,rateLimited=false}={}){
 const calls=[],inferences=[],logs=[];let claimed=false,finishes=0;
 const model=httpsServer({key,cert},async(req,res)=>{
  const value=await body(req);inferences.push(value);
  if(rateLimited){res.writeHead(429,{'retry-after':'5'}).end('{}');return;}
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(invalid?{...answer,evidence:'존재하지 않는 원문'}:answer)}}]}));
 });
 const db=httpServer(async(req,res)=>{
  const args=await body(req),name=req.url.split('/').at(-1);calls.push({name,args});let result=true;
  if(name==='learning_job_claim'){result=claimed?null:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',lease:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',kind:'analysis',attempt:1,input};claimed=true;}
  if(name==='learning_job_finish'&&ackFailure&&++finishes===1){res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({message:'simulated lost acknowledgement',code:'PGRST000'}));return;}
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
 });
 const modelPort=await listen(model),dbPort=await listen(db);
 const worker=spawn(process.execPath,['--experimental-strip-types','scripts/learning-worker.mjs'],{cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_EXTRA_CA_CERTS:join(temp,'cert.pem'),NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${dbPort}`,SUPABASE_SECRET_KEY:'test-service-key',AI_ENDPOINT:`https://127.0.0.1:${modelPort}/chat/completions`,AI_API_KEY:'test-model-key',AI_MODEL:'fixture-only',PORT:'0'},stdio:['ignore','pipe','pipe']});
 worker.stdout.on('data',data=>logs.push(data.toString()));worker.stderr.on('data',data=>logs.push(data.toString()));
 t.after(async()=>{if(worker.exitCode===null){worker.kill('SIGTERM');await Promise.race([new Promise(r=>worker.once('exit',r)),pause(7000).then(()=>worker.kill('SIGKILL'))]);}await close(db);await close(model);});
 return {calls,inferences,logs,worker};
}
test('real server worker finishes validated analysis and exits on SIGTERM',{timeout:15000},async t=>{
 const s=await run(t);await until(()=>s.logs.join('').includes('job_applied'));
 assert.equal(s.inferences.length,1);const finish=s.calls.find(c=>c.name==='learning_job_finish');assert.equal(finish.args.p_result.recommendation,'transfer_check');assert.equal(finish.args.p_result.teacherApprovalRequired,true);
 assert.equal(s.calls.filter(c=>c.name==='learning_job_fail').length,0);assert.ok(!s.logs.join('').includes(input.reason));assert.ok(!s.logs.join('').includes('test-model-key'));
 s.worker.kill('SIGTERM');await until(()=>s.worker.exitCode!==null);assert.equal(s.worker.exitCode,0);
});
test('unconfirmed finish retries identical output without reinference or failure overwrite',{timeout:15000},async t=>{
 const s=await run(t,{ackFailure:true});await until(()=>s.logs.join('').includes('job_applied'));
 const finishes=s.calls.filter(c=>c.name==='learning_job_finish');assert.equal(finishes.length,2);assert.deepEqual(finishes[0].args,finishes[1].args);assert.equal(s.inferences.length,1);assert.equal(s.calls.filter(c=>c.name==='learning_job_fail').length,0);
});
test('invented evidence fails closed without saving a proposed assessment',{timeout:15000},async t=>{
 const s=await run(t,{invalid:true});await until(()=>s.calls.some(c=>c.name==='learning_job_fail'));
 const fail=s.calls.find(c=>c.name==='learning_job_fail');assert.equal(fail.args.p_code,'invalid_evidence');assert.equal(fail.args.p_retry,false);assert.equal(s.calls.filter(c=>c.name==='learning_job_finish').length,0);
});
test('provider 429 schedules a bounded retry rather than fabricating an answer',{timeout:15000},async t=>{
 const s=await run(t,{rateLimited:true});await until(()=>s.calls.some(c=>c.name==='learning_job_fail'));
 const fail=s.calls.find(c=>c.name==='learning_job_fail');assert.equal(fail.args.p_retry,true);assert.equal(fail.args.p_code,'model_rate_limit');assert.ok(fail.args.p_delay_ms>=5000&&fail.args.p_delay_ms<=300000);assert.equal(s.calls.filter(c=>c.name==='learning_job_finish').length,0);
});
