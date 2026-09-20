import { AgentError, boundedJson, GATEWAY_BASE, GATEWAY_ENDPOINT, providerError } from './agent.mjs';

/** Read-only preflight. It does not send any prompt or activate/purchase credits.
 * Catalog presence is not proof of schema support, privacy eligibility or quality.
 * @param {import('./agent.mjs').ModelConfig} config
 * @param {typeof fetch} [fetchFn]
 */
export async function checkGateway(config, fetchFn = fetch) {
  if (config.provider!=='vercel' || config.endpoint!==GATEWAY_ENDPOINT) throw new AgentError('configuration');
  /** @param {string} path @param {boolean} auth @param {number} maxBytes */
  const get = async (path, auth, maxBytes) => {
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),15_000);
    try {
      const response = await fetchFn(GATEWAY_BASE+path,{method:'GET',redirect:'error',cache:'no-store',
        signal:controller.signal,headers:auth ? {Authorization:`Bearer ${config.key}`} : {}});
      if (!response.ok) throw await providerError(response);
      return await boundedJson(response,maxBytes);
    } catch (error) {
      if(controller.signal.aborted)throw new AgentError('timeout',true);
      if(error instanceof AgentError)throw error;
      throw new AgentError('network',true);
    } finally {clearTimeout(timeout);}
  };
  const credit = await get('/credits',true,8*1024);
  const balance = credit?.balance;
  // Credits are documented as decimal strings. Ignore other account fields.
  if (typeof balance!=='string' || !/^-?\d+(\.\d+)?$/.test(balance) || !Number.isFinite(Number(balance)))
    throw new AgentError('invalid_output');
  const catalog = await get('/models',false,2*1024*1024);
  if (!Array.isArray(catalog?.data)) throw new AgentError('invalid_output');
  const model = catalog.data.find(/** @param {any} item */item=>item?.id===config.model);
  if (!model || (model.type && model.type!=='language')) throw new AgentError('provider_request');
  /** @type {Record<string,string>} */
  const prices = {};
  for (const field of ['input','output']) {
    const value = model.pricing?.[field];
    if (typeof value==='string' && /^\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value))) prices[field]=value;
  }
  return {status:'configuration_checked',model:config.model,creditBalanceUsd:balance,unitPricesUsdPerToken:prices,
    requestedPrivacy:config.privacy ?? 'zdr',inferenceChecked:false};
}
