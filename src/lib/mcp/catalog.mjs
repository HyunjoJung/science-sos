/** Public, editorial link directory. No classroom records, answer keys or site scraping.
 * The descriptions below are our own navigation notes, not quoted source content.
 */
export const CATALOG_VERSION = '2026-09-20.1';
export const TOPICS = Object.freeze([
  Object.freeze({subject:'science',topic:'density',label:'질량·밀도·부력'}),
  Object.freeze({subject:'mathematics',topic:'fractions',label:'분수의 크기 비교'}),
]);
const notice = '외부 사이트로 이동합니다. 교사가 학년·언어·접근 조건과 수업 적합성을 직접 확인하세요. 교육과정 적합성이나 학습 효과를 인증한 자료가 아닙니다.';
const records = [
  {id:'phet-buoyancy',version:'1.0.0',subject:'science',topic:'density',title:'PhET · 부력 탐구',provider:'University of Colorado Boulder / PhET',url:'https://phet.colorado.edu/en/simulations/buoyancy',kind:'simulation',language:'다국어 선택',summary:'밀도와 부력을 비교하는 시뮬레이션의 공식 안내 페이지입니다.',checkedAt:'2026-09-20',packIds:['science-density']},
  {id:'phet-fractions',version:'1.0.0',subject:'mathematics',topic:'fractions',title:'PhET · 분수 표현 탐구',provider:'University of Colorado Boulder / PhET',url:'https://phet.colorado.edu/en/simulations/fractions-intro',kind:'simulation',language:'다국어 선택',summary:'분수를 여러 표현으로 살펴보는 시뮬레이션의 공식 안내 페이지입니다.',checkedAt:'2026-09-20',packIds:['math-fractions']},
  {id:'ebs-math',version:'1.0.0',subject:'mathematics',topic:'fractions',title:'EBSMath · 수학 자료 찾기',provider:'EBS',url:'https://www.ebsmath.co.kr/',kind:'portal',language:'한국어',summary:'EBS 수학 학습 포털입니다. 특정 분수 강의가 아니라 교사가 자료를 찾는 시작 페이지입니다.',checkedAt:'2026-09-20',packIds:['math-fractions']},
  {id:'khan-fractions',version:'1.0.0',subject:'mathematics',topic:'fractions',title:'Khan Academy · 분수 단원',provider:'Khan Academy',url:'https://www.khanacademy.org/math/arithmetic/arith-review-fractions',kind:'course',language:'영어',summary:'분수 학습 단원의 공식 페이지입니다. 실제 수업에 사용할 설명과 연습 범위는 교사가 확인해야 합니다.',checkedAt:'2026-09-20',packIds:['math-fractions']},
];
/** @param {any} value */
function freeze(value) { if(value && typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value; }
export const catalogRecords = freeze(records.map(r=>({...r,notice})));
export class ResourceError extends Error {}
/** @param {any} r */
function publicRecord(r) { const {packIds,...publicFields}=r;return structuredClone(publicFields); }
/** Only closed subject/topic codes: no free-form student text, URLs or credentials. @param {unknown} input */
export function searchResources(input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new ResourceError('invalid_arguments');
  const args=/** @type {{subject?:unknown,topic?:unknown}} */(input);
  if(Object.keys(args).some(k=>!['subject','topic'].includes(k)) || !TOPICS.some(t=>t.subject===args.subject&&t.topic===args.topic))throw new ResourceError('invalid_arguments');
  return {catalogVersion:CATALOG_VERSION,mode:'curated_directory',resources:catalogRecords.filter(/** @param {any} r */r=>r.subject===args.subject&&r.topic===args.topic).map(publicRecord)};
}
/** @param {unknown} id */
export function getResource(id) {
  if(typeof id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(id))throw new ResourceError('invalid_arguments');
  const row=catalogRecords.find(/** @param {any} r */r=>r.id===id);
  if(!row)throw new ResourceError('not_found');
  return {catalogVersion:CATALOG_VERSION,resource:publicRecord(row)};
}
/** @param {{id:string,subject:string}} pack */
export function topicForPack(pack) {
  const row=catalogRecords.find(/** @param {any} r */r=>r.packIds.includes(pack.id)&&r.subject===pack.subject);
  return row?{subject:/** @type {string} */(row.subject),topic:/** @type {string} */(row.topic)}:null;
}
/** Rehydrate known IDs, never accept an MCP server's URL, text or injected instructions.
 * Catalog drift, duplicates and unknown IDs fail closed. @param {any} result @param {{subject:string,topic:string}} args */
export function validateResourceResult(result,args) {
  if(!result || result.catalogVersion!==CATALOG_VERSION || result.mode!=='curated_directory' || !Array.isArray(result.resources)||result.resources.length>4)throw new ResourceError('invalid_result');
  const allowed=searchResources(args).resources;
  const seen=new Set();
  return result.resources.map(/** @param {any} item */item=>{
    const trusted=allowed.find(/** @param {any} r */r=>r.id===item?.id&&r.version===item?.version);
    if(!trusted || seen.has(item.id)||item.url!==trusted.url)throw new ResourceError('invalid_result');
    seen.add(item.id);return {id:trusted.id,version:trusted.version};
  });
}
