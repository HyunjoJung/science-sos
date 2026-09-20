import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';

// Exercise the actual Next HTTP route against the disposable PostgreSQL bridge.
// No live Supabase credentials, browser interception, Cursor session or model call.
const database = new URL(process.env.TEST_DATABASE_URL || 'postgres://invalid/');
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/learning_test');
assert.equal(database.search + database.hash, '');
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:55321');
assert.ok(process.env.SUPABASE_SECRET_KEY === 'sb_secret_ci_only', 'Only the dummy CI service key is allowed');
const base = new URL(process.env.APP_ORIGIN || 'http://localhost:3000');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
assert.equal(base.protocol, 'http:');
assert.equal(base.pathname, '/');
assert.equal(base.search + base.hash + base.username + base.password, '');
const {sql, literal} = await import('./fixtures.mjs');
const endpoint = new URL('/api/trial', base);
const cookieName = 'science-sos-trial';
const prediction = '나무는 뜨고 철은 가라앉아요';
const reason = '물체와 물의 밀도를 비교했어요.';
const body = (changes = {}) => ({request: randomUUID(), prediction, reason, ...changes});

async function request({method = 'GET', cookie, input, raw, origin = base.origin, headers = {}, suffix = '', stream = false} = {}) {
  const outgoing = new Headers(headers);
  if (cookie) outgoing.set('Cookie', cookie);
  let payload;
  if (method === 'POST') {
    if (origin !== null) outgoing.set('Origin', origin);
    if (!outgoing.has('Content-Type')) outgoing.set('Content-Type', 'application/json');
    const text = raw ?? JSON.stringify(input ?? body());
    payload = stream ? new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode(text)); controller.close();}}) : text;
  }
  const response = await fetch(endpoint.href + suffix, {
    method, headers: outgoing, body: payload, ...(stream ? {duplex: 'half'} : {}),
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json();
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(response.headers.get('x-request-id'));
  assert.equal(JSON.stringify(json).includes('sb_secret_ci_only'), false);
  return {response, json};
}

async function expectFailure(options, status, code) {
  const result = await request(options);
  assert.equal(result.response.status, status, `${code}: HTTP status`);
  assert.equal(result.json.code, code);
  assert.equal('job' in result.json, false);
  return result;
}

async function session() {
  const result = await request();
  assert.equal(result.response.status, 200);
  const setCookie = result.response.headers.getSetCookie().find(value => value.startsWith(cookieName + '='));
  assert.ok(setCookie, 'First GET must bootstrap the visitor cookie');
  assert.match(setCookie, /;\s*HttpOnly(?:;|$)/i);
  assert.match(setCookie, /;\s*SameSite=Strict(?:;|$)/i);
  assert.match(setCookie, /;\s*Path=\/(?:;|$)/i);
  assert.match(setCookie, /;\s*Max-Age=86400(?:;|$)/i);
  assert.doesNotMatch(setCookie, /;\s*Domain=/i);
  assert.doesNotMatch(setCookie, /;\s*Secure(?:;|$)/i, 'HTTP CI uses the HTTP cookie; HTTPS uses __Host- and Secure');
  const cookie = setCookie.split(';', 1)[0];
  assert.match(cookie.slice(cookieName.length + 1), /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(result.json).sort(), ['job', 'online', 'remaining']);
  return {...result, cookie};
}

function assertPublicJob(job) {
  assert.deepEqual(Object.keys(job).sort(), ['created_at', 'finished_at', 'id', 'prediction', 'reason', 'result', 'status']);
  assert.equal(job.prediction, prediction);
  assert.equal(job.reason, reason);
  assert.equal(job.status, 'queued');
  assert.equal(job.result, null);
}

const count = () => Number(sql('select count(*) from public.trial_jobs'));
sql('truncate public.trial_jobs; update public.trial_control set heartbeat_at=null where singleton;');
try {
  const first = await session();
  assert.deepEqual(first.json, {online: false, remaining: 3, job: null});
  const same = await request({cookie: first.cookie});
  assert.deepEqual(same.json, first.json);
  assert.equal(same.response.headers.getSetCookie().length, 0, 'Polling must not rotate a valid session');
  await expectFailure({headers: {'sec-fetch-site': 'cross-site'}}, 403, 'INVALID_ORIGIN');
  await expectFailure({method: 'POST'}, 401, 'SESSION_REQUIRED');
  await expectFailure({method: 'POST', cookie: cookieName + '=not-a-session'}, 401, 'SESSION_REQUIRED');
  await expectFailure({method: 'POST', cookie: first.cookie, origin: 'https://different-site.invalid'}, 403, 'INVALID_ORIGIN');
  await expectFailure({method: 'POST', cookie: first.cookie, origin: null}, 403, 'INVALID_ORIGIN');
  await expectFailure({method: 'POST', cookie: first.cookie, headers: {'Content-Type': 'text/plain'}}, 415, 'UNSUPPORTED_MEDIA_TYPE');
  await expectFailure({method: 'POST', cookie: first.cookie, raw: '{'}, 400, 'BAD_JSON');
  for (const input of [body({reason: ''}), body({reason: '   '}), body({reason: '가'.repeat(301)}), body({prediction: '허용되지 않은 답'}), body({request: 'invalid'}), body({session_hash: 'a'.repeat(64)})]) {
    await expectFailure({method: 'POST', cookie: first.cookie, input}, 422, 'INVALID_INPUT');
  }
  const tooLarge = JSON.stringify(body({reason: '가'.repeat(2000)}));
  assert.ok(Buffer.byteLength(tooLarge) > 4096);
  await expectFailure({method: 'POST', cookie: first.cookie, raw: tooLarge}, 413, 'PAYLOAD_TOO_LARGE');
  await expectFailure({method: 'POST', cookie: first.cookie, raw: tooLarge, stream: true}, 413, 'PAYLOAD_TOO_LARGE');
  const offline = await expectFailure({method: 'POST', cookie: first.cookie}, 503, 'WORKER_OFFLINE');
  assert.equal(offline.response.headers.get('retry-after'), '30');
  assert.equal(count(), 0, 'Rejected HTTP requests must never enter the queue');
  console.log('PASS trial HTTP: session cookie, strict origin, input and byte limits, offline rejection');

  sql('update public.trial_control set heartbeat_at=now() where singleton');
  const command = body();
  const accepted = await request({method: 'POST', cookie: first.cookie, input: command});
  assert.equal(accepted.response.status, 202);
  assertPublicJob(accepted.json.job);
  const persisted = JSON.parse(sql(`select to_jsonb(j) from public.trial_jobs j where request_id=${literal(command.request)}::uuid`));
  assert.equal(persisted.id, accepted.json.job.id);
  assert.equal(persisted.prediction, command.prediction);
  assert.equal(persisted.reason, command.reason);
  assert.equal(persisted.status, 'queued');
  assert.match(persisted.session_hash, /^[a-f0-9]{64}$/);
  assert.match(persisted.ip_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(persisted.session_hash, first.cookie.slice(cookieName.length + 1));
  const own = await request({cookie: first.cookie});
  assert.equal(own.json.online, true);
  assert.equal(own.json.remaining, 2);
  assert.equal(own.json.job.id, accepted.json.job.id);
  assertPublicJob(own.json.job);

  // An unrecognised, well-formed random capability sees only its empty session.
  const unknownCookie = cookieName + '=' + randomBytes(32).toString('hex');
  const unknown = await request({cookie: unknownCookie, suffix: '?id=' + accepted.json.job.id});
  assert.deepEqual(unknown.json, {online: true, remaining: 3, job: null});
  const second = await session();
  assert.notEqual(second.cookie, first.cookie);
  assert.equal(second.json.job, null);
  const secondAccepted = await request({method: 'POST', cookie: second.cookie, input: body()});
  assert.equal(secondAccepted.response.status, 202);
  assert.notEqual(secondAccepted.json.job.id, accepted.json.job.id);
  assert.equal((await request({cookie: first.cookie})).json.job.id, accepted.json.job.id);
  assert.equal((await request({cookie: second.cookie})).json.job.id, secondAccepted.json.job.id);
  console.log('PASS trial HTTP -> PostgreSQL: persisted enqueue and session-only status without internal hashes or leases');

  const replays = await Promise.all([request({method: 'POST', cookie: first.cookie, input: command}), request({method: 'POST', cookie: first.cookie, input: command})]);
  for (const replay of replays) {
    assert.equal(replay.response.status, 202);
    assert.equal(replay.json.job.id, accepted.json.job.id);
  }
  assert.equal(count(), 2, 'Concurrent identical retries must not create another job');
  await expectFailure({method: 'POST', cookie: first.cookie, input: {...command, reason: '다른 이유'}}, 409, 'CONFLICT');
  assert.equal(count(), 2);
  for (let n = 0; n < 2; n++) assert.equal((await request({method: 'POST', cookie: first.cookie, input: body()})).response.status, 202);
  assert.equal((await request({cookie: first.cookie})).json.remaining, 0);
  await expectFailure({method: 'POST', cookie: first.cookie}, 429, 'RATE_LIMITED');
  assert.equal(count(), 4);

  sql('update public.trial_control set heartbeat_at=null where singleton');
  assert.equal((await request({cookie: second.cookie})).json.online, false);
  await expectFailure({method: 'POST', cookie: second.cookie}, 503, 'WORKER_OFFLINE');
  const savedReplay = await request({method: 'POST', cookie: first.cookie, input: command});
  assert.equal(savedReplay.response.status, 202, 'An acknowledged job remains retrievable when the worker goes offline');
  assert.equal(savedReplay.json.job.id, accepted.json.job.id);
  assert.equal(count(), 4);
  console.log('PASS trial HTTP: concurrent idempotency, conflict, quota and saved retry while worker offline');
} finally {
  // Only the dedicated disposable trial tables are changed by this script.
  sql('truncate public.trial_jobs; update public.trial_control set heartbeat_at=null where singleton;');
}
