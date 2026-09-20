import { readFile } from 'node:fs/promises';
import { createServiceRpc } from './learning-service.mjs';
const packs=JSON.parse(await readFile(new URL('../content/learning-packs.json',import.meta.url),'utf8'));
const rpc=createServiceRpc(process.env);
for(const pack of packs){
 if(await rpc('learning_register_pack',{p_pack:pack})!==true)throw Error('pack_registration_failed');
 console.log(`Registered ${pack.id}@${pack.version}; teacher review/assignment still required.`);
}
