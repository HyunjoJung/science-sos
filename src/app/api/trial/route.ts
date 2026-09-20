import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { ApiError, assertSameOrigin, errorReply, jsonReply, readJsonObject, rpcError } from '@/lib/server/api-http';
import { newTrialToken, validTrialToken, trialSessionHash, trialIpHash } from '@/lib/trial/security.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  request: z.uuid(),
  prediction: z.enum(['나무는 가라앉고 철은 떠요', '나무는 뜨고 철은 가라앉아요', '둘 다 떠요', '둘 다 가라앉아요']),
  reason: z.string().trim().min(1).max(300),
}).strict();
const resultSchema = z.object({
  hypothesis: z.enum(['mass_only', 'size_only', 'liquid_missed', 'other', 'hold']),
  reason_status: z.enum(['supported', 'contradictory', 'insufficient']),
  evidence: z.string().max(300), note: z.string().max(500),
});
const jobSchema = z.object({
  id: z.uuid(), status: z.enum(['queued', 'running', 'ready', 'error']),
  prediction: z.string(), reason: z.string().max(300), result: resultSchema.nullable(),
  created_at: z.string(), finished_at: z.string().nullable(),
});
const statusSchema = z.object({ online: z.boolean(), remaining: z.number().int().min(0).max(3), job: jobSchema.nullable() });

function connection() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new ApiError('NOT_CONFIGURED');
  // This client is only for the dedicated trial RPCs. Never reuse browser auth or
  // accept a table/function name from a caller. No service key enters the client bundle.
  return { secret, client: createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, {
      ...init, signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    }) },
  }) };
}
function cookieName(req: NextRequest) {
  return req.nextUrl.protocol === 'https:' ? '__Host-science-sos-trial' : 'science-sos-trial';
}
function failed(error: unknown, requestId: string) {
  if (error instanceof Error && error.message === 'worker_unavailable') {
    const response = jsonReply({ code: 'WORKER_OFFLINE', error: '지금은 AI 연결을 준비하고 있어요. 잠시 후 다시 확인해 주세요.', requestId }, requestId, 503);
    response.headers.set('Retry-After', '30');
    return response;
  }
  return errorReply(error instanceof z.ZodError ? new ApiError('INVALID_INPUT') : error, requestId);
}
function databaseError(error: { message?: string; code?: string }) {
  if (error.message?.trim() === 'worker_unavailable') return new Error('worker_unavailable');
  return rpcError(error);
}

export async function GET(req: NextRequest) {
  const id = crypto.randomUUID();
  try {
    // Do not let cross-site background requests replace a visitor's session cookie.
    if (req.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError('INVALID_ORIGIN');
    const { client } = connection();
    const jar = await cookies();
    const existing = jar.get(cookieName(req))?.value;
    const token = validTrialToken(existing) ? existing! : newTrialToken();
    const { data, error } = await client.rpc('trial_status', { p_session_hash: trialSessionHash(token) });
    if (error) throw databaseError(error);
    const parsed = statusSchema.safeParse(data);
    if (!parsed.success) throw new ApiError('UNAVAILABLE');
    if (token !== existing) jar.set(cookieName(req), token, {
      httpOnly: true, secure: req.nextUrl.protocol === 'https:', sameSite: 'strict', path: '/', maxAge: 86400,
    });
    return jsonReply(parsed.data, id);
  } catch (error) { return failed(error, id); }
}

export async function POST(req: NextRequest) {
  const id = crypto.randomUUID();
  try {
    // Trial requests must come from this exact deployment; no cross-preview cookies.
    assertSameOrigin(req);
    const input = inputSchema.parse(await readJsonObject(req, 4096));
    const token = (await cookies()).get(cookieName(req))?.value;
    if (!validTrialToken(token)) {
      return jsonReply({ code: 'SESSION_REQUIRED', error: '체험 연결을 다시 확인한 뒤 입력을 보내 주세요.', requestId: id }, id, 401);
    }
    const { client, secret } = connection();
    const { data, error } = await client.rpc('trial_enqueue', {
      p_session_hash: trialSessionHash(token!),
      p_ip_hash: trialIpHash(req.headers, secret, process.env.VERCEL === '1'),
      p_request: input.request, p_prediction: input.prediction, p_reason: input.reason,
    });
    if (error) throw databaseError(error);
    const parsed = jobSchema.safeParse(data);
    if (!parsed.success) throw new ApiError('UNAVAILABLE');
    return jsonReply({ job: parsed.data }, id, 202);
  } catch (error) { return failed(error, id); }
}
