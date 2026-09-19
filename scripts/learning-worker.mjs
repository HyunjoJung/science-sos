import { createAnalyzer, modelConfig, workOnce } from '../src/lib/learning/agent.mjs';
import { createServiceRpc } from './learning-service.mjs';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const rpc=createServiceRpc(process.env);
const analyze=createAnalyzer(modelConfig(process.env));
const stop=new AbortController();
let healthyAt=0, failureCount=0;
const port=Number(process.env.WORKER_PORT || 8080);
if (!Number.isInteger(port) || port<1 || port>65535) throw Error('invalid_worker_port');
const server=createServer((req,res)=>{
  if(req.url!=='/healthz'){res.writeHead(404).end();return;}
  const healthy=Date.now()-healthyAt<120_000 && !stop.signal.aborted;
  res.writeHead(healthy?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify({status:healthy?'ok':'unavailable'}));
});
server.listen(port,'0.0.0.0');
const shutdown=()=>{stop.abort();server.close();};
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
console.log(JSON.stringify({event:'learning_worker_started'}));
try {
 while(!stop.signal.aborted) {
  let wait=100;
  try {
   const status=await workOnce({rpc,analyze,signal:stop.signal,log:e=>console.log(JSON.stringify(e))});
   healthyAt=Date.now();failureCount=0;wait=status==='idle'?2000:100;
  } catch {
   failureCount++;wait=Math.min(30_000,1000*2**Math.min(failureCount,5))+Math.random()*500;
   console.error(JSON.stringify({event:'learning_worker_connection_failure'}));
  }
  try { await delay(wait,undefined,{signal:stop.signal}); } catch { break; }
 }
} finally {server.close();}
