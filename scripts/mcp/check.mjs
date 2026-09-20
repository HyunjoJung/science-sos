// Read-only smoke check; does not call Gateway, Auth, or private classroom tools.
import {createResourceLookup} from '../../src/lib/mcp/client.mjs';
if(process.env.LEARNING_RESOURCE_MODE!=='mcp')throw Error('Set LEARNING_RESOURCE_MODE=mcp and APP_ORIGIN to the deployed app.');
const lookup=createResourceLookup(process.env);
for(const pack of [{id:'science-density',subject:'science'},{id:'math-fractions',subject:'mathematics'}]){
 const result=await lookup(pack);
 console.log(JSON.stringify({subject:pack.subject,...result}));
 if(result.status!=='ok'||result.candidates.length===0)process.exitCode=1;
}
