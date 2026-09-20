// Independent post-journey evidence gate. Only synthetic CI database data is read.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const target=new URL(process.env.TEST_DATABASE_URL||'postgres://invalid/');
assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.pathname==='/learning_test','Disposable learning_test database required');
const {sql}=await import('./fixtures.mjs');
const rows=JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object(
 'pack_id',a.pack_id,'stage',a.stage,'input_version',j.input_version,
 'job_status',j.status,'attempts',j.attempts,
 'model',a.analysis->>'model','rule_verdict',a.analysis->>'ruleVerdict',
 'evidence_present',length(coalesce(a.analysis->>'quote',''))>0,
 'analysis_events',(select count(*) from private.learning_events e where e.attempt_id=a.id and action='analysis_completed')
) order by a.pack_id),'[]'::jsonb)
from private.learning_attempts a join private.learning_jobs j on j.attempt_id=a.id`));
await writeFile('.test-results/persisted-worker-evidence.json',JSON.stringify(rows,null,2));
assert.equal(rows.length,2,'Both browser journeys must create one persisted attempt/job');
assert.deepEqual(rows.map(r=>r.pack_id),['math-fractions','science-density']);
for(const row of rows){
 assert.equal(row.stage,'completed');assert.equal(row.job_status,'succeeded');
 assert.equal(row.model,'ci-fixture');assert.equal(row.rule_verdict,'correct');
 assert.equal(row.evidence_present,true);assert.equal(row.analysis_events,1);
 assert.ok(row.attempts>=1&&row.attempts<=3);
}
console.log('PASS independent PostgreSQL evidence: two completed journeys, persisted model results, exactly one analysis event per attempt.');
