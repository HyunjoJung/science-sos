// Disposable PostgreSQL only. These are queue/privilege fixtures, never model responses.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";

const database = new URL(process.env.TEST_DATABASE_URL || "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(database.pathname, "/learning_test");
assert.equal(database.search, "");
const url = process.env.TEST_DATABASE_URL;
const lit = (value) => value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const session = hash("one-session"), ip = hash("one-ip"), prediction = "나무는 가라앉고 철은 떠요", reason = "나무가 더 무거우니까 가라앉아요.";
const sql = (query) => execFileSync("psql", [url, "-X", "-v", "ON_ERROR_STOP=1", "-Atq", "-c", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const service = (query) => sql(`begin;set local role service_role;${query};commit;`);
const parse = (value) => JSON.parse(value || "null");
const status = (owner = session) => parse(service(`select public.trial_status(${lit(owner)})`));
function enqueue(owner = session, address = ip, request = randomUUID(), text = reason, choice = prediction) {
  return parse(service(`select public.trial_enqueue(${lit(owner)},${lit(address)},${lit(request)}::uuid,${lit(choice)},${lit(text)})`));
}
const tick = (claim = true) => parse(service(`select public.trial_tick(${claim})`));
const finish = (job, result = null, error = true, lease = job.lease) => service(`select public.trial_finish(${lit(job.id)}::uuid,${lit(lease)}::uuid,${lit(result === null ? null : JSON.stringify(result))}::jsonb,${error})`);
const proposal = { hypothesis: "mass_only", reason_status: "supported", evidence: "더 무거우니까", note: "질량과 부피를 함께 비교해 보세요." };
const seedTerminal = (count, address = null) => sql(`insert into public.trial_jobs(session_hash,ip_hash,request_id,prediction,reason,status,finished_at)
  select repeat(md5('seed-session-'||i::text),2),${address ? lit(address) : "repeat(md5('seed-ip-'||i::text),2)"},gen_random_uuid(),${lit(prediction)},${lit(reason)},'error',now() from generate_series(1,${count}) i`);

beforeEach(() => {
  sql("truncate public.trial_jobs;update public.trial_control set heartbeat_at=null;");
});
after(() => { sql("truncate public.trial_jobs;update public.trial_control set heartbeat_at=null;"); });

test("trial tables and RPCs deny browser roles; functions remain SECURITY INVOKER", () => {
  const calls = ["public.trial_status(null)", `public.trial_enqueue(${lit(session)},${lit(ip)},gen_random_uuid(),${lit(prediction)},${lit(reason)})`, "public.trial_tick(false)", "public.trial_finish(gen_random_uuid(),gen_random_uuid(),null,true)"];
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["trial_jobs", "trial_control"]) {
      assert.throws(() => sql(`set role ${role};select * from public.${table}`), /permission denied/);
      assert.throws(() => sql(`set role ${role};delete from public.${table}`), /permission denied/);
    }
    for (const call of calls) assert.throws(() => sql(`set role ${role};select ${call}`), /permission denied/);
  }
  assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('trial_status','trial_enqueue','trial_tick','trial_finish') and p.prosecdef"), "0");
  assert.equal(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('trial_jobs','trial_control') and c.relrowsecurity"), "2");
});

test("worker availability gates enqueue and heartbeat-only calls never claim", () => {
  assert.deepEqual(status(null), { online: false, remaining: 3, job: null });
  assert.throws(() => enqueue(), /worker_unavailable/);
  assert.equal(tick(false), null);
  assert.equal(status().online, true);
  const queued = enqueue();
  assert.equal(tick(false), null);
  assert.equal(status().job.id, queued.id);
  assert.equal(status().job.status, "queued");
  sql("update public.trial_control set heartbeat_at=now()-interval '121 seconds'");
  assert.equal(status().online, false);
  assert.throws(() => enqueue(hash("other")), /worker_unavailable/);
});

test("database rejects malformed identity, unknown choices and missing or oversized reasons", () => {
  tick(false);
  for (const value of [null, "", "raw-token", "F".repeat(64)]) {
    assert.throws(() => enqueue(value), /invalid_input/);
    assert.throws(() => enqueue(session, value), /invalid_input/);
  }
  for (const value of [null, "", " ", "x".repeat(301)]) assert.throws(() => enqueue(session, ip, randomUUID(), value), /invalid_input/);
  assert.throws(() => enqueue(session, ip, randomUUID(), reason, "injected choice"), /invalid_input/);
  assert.throws(() => enqueue(session, ip, null), /invalid_input/);
  assert.equal(status().remaining, 3);
});

test("session hashes isolate status and public result omits all queue credentials", () => {
  tick(false);
  const first = enqueue();
  const second = enqueue(hash("second"), hash("second-ip"));
  assert.equal(status().job.id, first.id);
  assert.equal(status(hash("second")).job.id, second.id);
  assert.equal(status(hash("unknown")).job, null);
  assert.equal(status(null).job, null);
  assert.deepEqual(Object.keys(first).sort(), ["id", "status", "prediction", "reason", "result", "created_at", "finished_at"].sort());
  assert.deepEqual(Object.keys(status().job).sort(), Object.keys(first).sort());
});

test("identical request replays once, including offline; changed payload conflicts", () => {
  tick(false);
  const request = randomUUID(), first = enqueue(session, ip, request);
  sql("update public.trial_control set heartbeat_at=null");
  assert.deepEqual(enqueue(session, hash("changed-network"), request), first);
  assert.throws(() => enqueue(session, ip, request, "새로운 이유"), /idempotency_conflict/);
  assert.equal(status().remaining, 2);
  assert.equal(sql("select count(*) from public.trial_jobs"), "1");
});

test("concurrent duplicate requests have one effect and identical ID", async () => {
  tick(false);
  const request = randomUUID();
  const query = `begin;set local role service_role;select public.trial_enqueue(${lit(session)},${lit(ip)},${lit(request)}::uuid,${lit(prediction)},${lit(reason)});commit;`;
  const run = () => promisify(execFile)("psql", [url, "-X", "-v", "ON_ERROR_STOP=1", "-Atq", "-c", query]);
  const result = await Promise.all([run(), run()]);
  assert.equal(parse(result[0].stdout.trim()).id, parse(result[1].stdout.trim()).id);
  assert.equal(sql("select count(*) from public.trial_jobs"), "1");
});

test("session, IP and global daily limits are independent of completion state", () => {
  tick(false);
  for (let i = 0; i < 3; i++) { enqueue(); finish(tick()); }
  assert.equal(status().remaining, 0);
  assert.throws(() => enqueue(), /rate_limit/);
  sql("truncate public.trial_jobs");
  seedTerminal(10, ip);
  assert.throws(() => enqueue(), /rate_limit/);
  enqueue(session, hash("different-ip"));
  sql("truncate public.trial_jobs");
  seedTerminal(49);
  enqueue(); finish(tick());
  assert.throws(() => enqueue(hash("new-owner"), hash("new-ip")), /rate_limit/);
  assert.equal(sql("select count(*) from public.trial_jobs"), "50");
});

test("active queue cap is enforced and a terminal job opens one slot", () => {
  tick(false);
  for (let i = 0; i < 5; i++) enqueue(hash(`session-${i}`), hash(`ip-${i}`));
  assert.throws(() => enqueue(), /rate_limit/);
  const running = tick();
  assert.throws(() => enqueue(), /rate_limit/);
  assert.equal(finish(running), "t");
  assert.equal(enqueue().status, "queued");
});

test("claim and completion require the current lease and accept only grounded schema", () => {
  tick(false); enqueue();
  const job = tick();
  assert.equal(status().job.status, "running");
  assert.equal(tick(), null);
  assert.equal(finish(job, proposal, false, randomUUID()), "f");
  for (const value of [null, {}, { ...proposal, hypothesis: "invented" }, { ...proposal, evidence: "not in reason" },
    { ...proposal, evidence: "" }, { ...proposal, reason_status: "insufficient" }, { ...proposal, secret: "extra key" },
    { ...proposal, note: "x".repeat(501) }, { ...proposal, evidence: null }]) {
    assert.throws(() => finish(job, value, false), /invalid_input/);
  }
  assert.equal(finish(job, proposal, false), "t");
  assert.equal(finish(job, null, true), "f");
  assert.deepEqual(status().job.result, proposal);
  assert.equal(status().job.status, "ready");
});

test("explicit model failure records an error with no fabricated result", () => {
  tick(false); enqueue();
  const job = tick();
  assert.equal(finish(job), "t");
  assert.equal(status().job.status, "error");
  assert.equal(status().job.result, null);
  assert.ok(status().job.finished_at);
});

test("expired queues and leases are readable as errors even when the worker is offline", () => {
  tick(false); enqueue();
  sql("update public.trial_jobs set created_at=now()-interval '6 minutes'");
  assert.equal(status().job.status, "error");
  assert.equal(tick(), null);
  assert.equal(sql("select status from public.trial_jobs"), "error");
  enqueue();
  const job = tick();
  sql(`update public.trial_jobs set lease_expires_at=now()-interval '1 second' where id=${lit(job.id)}::uuid`);
  assert.equal(status().job.status, "error");
  assert.equal(finish(job, proposal, false), "f");
  assert.equal(tick(), null);
  assert.equal(sql(`select status from public.trial_jobs where id=${lit(job.id)}::uuid`), "error");
});

test("worker cleanup removes 24-hour-old text without touching ordinary classroom tables", () => {
  tick(false);
  const request = randomUUID();
  enqueue(session, ip, request);
  sql("update public.trial_jobs set created_at=now()-interval '25 hours'");
  assert.equal(status().job, null);
  assert.throws(() => enqueue(session, ip, request), /idempotency_conflict/);
  assert.equal(tick(), null);
  assert.equal(sql("select count(*) from public.trial_jobs"), "0");
});
