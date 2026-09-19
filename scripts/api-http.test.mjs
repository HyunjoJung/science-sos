import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, assertSameOrigin, authError, errorReply, jsonReply, readJsonObject, rpcError } from '../src/lib/server/api-http.ts';
const url = 'https://school.example/api/lab';
const make = (body, headers = {}) => new Request(url, {method: 'POST', body, headers: {'content-type': 'application/json', ...headers}});
const rejects = (request, limit, code) => assert.rejects(readJsonObject(request, limit), error => error instanceof ApiError && error.code === code);

test('accepts a JSON object containing Korean text', async () => {
  assert.deepEqual(await readJsonObject(make('{"reason":"나무는 떠요"}'), 1024), {reason:'나무는 떠요'});
});
test('content type is case insensitive and permits charset', async () => {
  assert.deepEqual(await readJsonObject(make('{}', {'content-type':'Application/JSON; charset=utf-8'}), 2), {});
});
for (const contentType of ['', 'text/plain', 'application/x-www-form-urlencoded']) {
  test(`rejects unsupported content type: ${contentType || '(empty)'}`, () => rejects(make('{}', {'content-type':contentType}), 100, 'UNSUPPORTED_MEDIA_TYPE'));
}
for (const raw of ['', '{', '{"a":1,}']) test(`rejects malformed JSON: ${JSON.stringify(raw)}`, () => rejects(make(raw), 100, 'BAD_JSON'));
for (const raw of ['null', '[]', '1', 'true', '"x"']) test(`rejects non-object root: ${raw}`, () => rejects(make(raw), 100, 'INVALID_INPUT'));
test('rejects missing body', () => rejects(new Request(url, {method:'POST',headers:{'content-type':'application/json'}}), 10, 'BAD_JSON'));
test('rejects invalid UTF-8 rather than silently replacing it', () => rejects(make(new Uint8Array([123,34,97,34,58,34,255,34,125])), 100, 'BAD_JSON'));
test('enforces exact UTF-8 byte boundary', async () => {
  const body = '{"a":"한글"}';
  const size = new TextEncoder().encode(body).length;
  assert.deepEqual(await readJsonObject(make(body), size), {a:'한글'});
  await rejects(make(body), size - 1, 'PAYLOAD_TOO_LARGE');
});
test('rejects declared oversized body', () => rejects(make('{}', {'content-length':'1000'}), 100, 'PAYLOAD_TOO_LARGE'));
test('does not trust a falsely small Content-Length', () => rejects(make('{"a":"long"}', {'content-length':'1'}), 5, 'PAYLOAD_TOO_LARGE'));
test('rejects invalid Content-Length', () => rejects(make('{}', {'content-length':'-1'}), 100, 'BAD_JSON'));
test('supports the existing 30,000-character material limit in Korean', async () => {
  const content = '가'.repeat(30000);
  assert.equal((await readJsonObject(make(JSON.stringify({content})), 256 * 1024)).content, content);
});
test('enforces cumulative chunked limit and cancels input', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new TextEncoder().encode('0123456789')); },
    cancel() { cancelled = true; },
  });
  const request = new Request(url, {method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'});
  await rejects(request, 12, 'PAYLOAD_TOO_LARGE');
  assert.equal(cancelled, true);
});
test('stream failures become safe malformed-request errors', async () => {
  const body = new ReadableStream({start(controller) { controller.error(new Error('secret')); }});
  await rejects(new Request(url, {method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'}), 100, 'BAD_JSON');
});
test('allows same origin and explicitly configured application origin', () => {
  assert.doesNotThrow(() => assertSameOrigin(make('{}', {origin:'https://school.example'})));
  assert.doesNotThrow(() => assertSameOrigin(make('{}', {origin:'https://class.example'}), 'https://class.example/'));
});
for (const origin of ['', 'null', 'https://school.example.evil.test', 'http://school.example']) {
  test(`rejects untrusted origin: ${origin || '(missing)'}`, () => assert.throws(() => assertSameOrigin(make('{}', {origin})), {code:'INVALID_ORIGIN'}));
}
for (const configured of ['not-a-url', 'https://school.example/path', 'https://user:pass@school.example', 'ftp://school.example']) {
  test(`rejects malformed APP_ORIGIN: ${configured}`, () => assert.throws(() => assertSameOrigin(make('{}', {origin:'https://school.example'}), configured), {code:'NOT_CONFIGURED'}));
}
for (const [message, status] of [['unauthorized',401],['forbidden',403],['not_found',404],['version_conflict',409],['idempotency_conflict',409],['forbidden_transition',409],['rate_limit',429],['invalid_input',422]]) {
  test(`maps database business error ${message}`, () => assert.equal(rpcError({message}).status, status));
}
test('does not classify arbitrary upstream text as a business error', () => {
  assert.equal(rpcError({message:'unexpected conflict while connecting',code:'08006'}).status, 503);
  assert.equal(rpcError({message:'constructor'}).status, 503);
  assert.equal(rpcError({message:'__proto__'}).status, 503);
});
test('maps malformed UUID/check violations without exposing database details', () => {
  assert.equal(rpcError({code:'22P02',message:'private relation and student data'}).status, 422);
  assert.equal(rpcError({code:'23514'}).status, 422);
});
test('distinguishes missing session from auth outage and throttling', () => {
  assert.equal(authError({name:'AuthSessionMissingError'}).status, 401);
  assert.equal(authError({code:'invalid_credentials',status:400}).status, 401);
  assert.equal(authError({status:503}).status, 503);
  assert.equal(authError({status:429}).status, 429);
});
test('responses are private/non-cacheable and carry a correlation id', async () => {
  const result = jsonReply({ok:true}, 'request-1');
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('x-request-id'), 'request-1');
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await result.json(), {ok:true});
});
test('429 response includes Retry-After and stable code', async () => {
  const result = errorReply(new ApiError('RATE_LIMITED'), 'request-2');
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('retry-after'), '60');
  assert.equal((await result.json()).code, 'RATE_LIMITED');
});
test('unknown errors never leak raw details into the response or logs', async () => {
  const logs = [];
  const original = console.error;
  console.error = value => logs.push(value);
  try {
    const result = errorReply(new Error('password=secret student=private'), 'request-3');
    assert.equal(result.status, 500);
    const body = await result.text();
    assert.ok(!body.includes('secret') && !body.includes('private'));
    assert.ok(logs.length === 1 && !logs[0].includes('secret'));
    assert.equal(JSON.parse(logs[0]).requestId, 'request-3');
  } finally { console.error = original; }
});
