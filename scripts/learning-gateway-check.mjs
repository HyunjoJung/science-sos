import { pathToFileURL } from 'node:url';
import { AgentError, createAnalyzer, modelConfig } from '../src/lib/learning/agent.mjs';
import { checkGateway } from '../src/lib/learning/gateway-check.mjs';

/** No DB access, no student data, no key creation or credit purchase.
 * --smoke explicitly opts into ONE metered inference of a synthetic question.
 * @param {string[]} args @param {Record<string,string|undefined>} env
 */
export async function main(args,env) {
  if (args.some(a=>a!=='--smoke') || args.length>1) throw new AgentError('configuration');
  const config=modelConfig(env);
  const report=await checkGateway(config);
  console.log(JSON.stringify(report));
  if (!args.includes('--smoke')) return;
  if(Number(report.creditBalanceUsd)<=0)throw new AgentError('provider_credit');
  const result=await createAnalyzer(config)({id:'synthetic-smoke',lease:'none',
    pack:{id:'smoke',version:'1.0.0',subject:'mathematics',scope:'합성 개발 검증: 자연수 덧셈',
      prompt:'사과 1개와 사과 1개를 합치면 몇 개인가요?',rubric:'하나와 하나를 세어 두 개임을 설명한다.',correctAnswer:'2'},
    response:{answer:'2',reason:'하나와 하나를 세면 두 개이기 때문이에요.'}});
  // Only safe status/provenance/usage; never echo credentials or response text.
  console.log(JSON.stringify({status:'synthetic_smoke_passed',requestedModel:result.requestedModel,
    servedModel:result.model,usage:result.usage,proposal:result.proposal.kind}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2),process.env).catch(error=>{
    console.error(JSON.stringify({event:'gateway_check_failed',code:error instanceof AgentError?error.code:'configuration'}));
    process.exitCode=1;
  });
}
