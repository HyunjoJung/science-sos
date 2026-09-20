/** Shared HTTP boundary. No SDK dependencies; tested with Node's native runner. */
const failures = {
  BAD_JSON: [400, "요청 형식을 확인해 주세요."],
  UNAUTHORIZED: [401, "로그인해 주세요."],
  LOGIN_FAILED: [401, "이메일 또는 비밀번호를 확인해 주세요."],
  FORBIDDEN: [403, "이 요청을 처리할 권한이 없어요."],
  INVALID_ORIGIN: [403, "허용되지 않은 요청이에요."],
  NOT_FOUND: [404, "기록을 찾을 수 없거나 접근 권한이 없어요."],
  CONFLICT: [409, "다른 화면에서 기록이 바뀌었어요. 새로고침 후 다시 확인해 주세요."],
  PAYLOAD_TOO_LARGE: [413, "요청 내용이 너무 커요. 내용을 줄여 주세요."],
  UNSUPPORTED_MEDIA_TYPE: [415, "JSON 형식으로 요청해 주세요."],
  INVALID_INPUT: [422, "입력값을 확인해 주세요. 설명은 1~300자로 작성할 수 있어요."],
  RATE_LIMITED: [429, "요청이 많아요. 잠시 후 다시 시도해 주세요."],
  NOT_CONFIGURED: [503, "아직 데이터베이스 연결이 준비되지 않았어요."],
  UNAVAILABLE: [503, "서비스 연결에 문제가 있어요. 입력 내용은 유지하고 다시 시도해 주세요."],
  INTERNAL_ERROR: [500, "요청을 처리하지 못했어요. 문제가 계속되면 문의해 주세요."],
} as const;

export type FailureCode = keyof typeof failures;
export class ApiError extends Error {
  readonly code: FailureCode;
  readonly status: number;
  constructor(code: FailureCode) {
    super(failures[code][1]);
    this.name = "ApiError";
    this.code = code;
    this.status = failures[code][0];
  }
}

export function jsonReply(data: unknown, requestId: string, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    },
  });
}

export function errorReply(error: unknown, requestId: string): Response {
  const safe = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
  // Never send/log raw SDK errors, student text, passwords or request bodies.
  if (safe.status >= 500)
    console.error(JSON.stringify({ event: "api_failure", requestId, code: safe.code, status: safe.status }));
  const response = jsonReply({ error: safe.message, code: safe.code, requestId }, requestId, safe.status);
  if (safe.code === "RATE_LIMITED") response.headers.set("Retry-After", "60");
  return response;
}

export function assertSameOrigin(request: Request, appOrigin?: string): void {
  const origin = request.headers.get("origin");
  const allowed = new Set([new URL(request.url).origin]);
  if (appOrigin) {
    let configured: URL;
    try { configured = new URL(appOrigin); }
    catch { throw new ApiError("NOT_CONFIGURED"); }
    if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password ||
        configured.search || configured.hash || configured.pathname !== '/')
      throw new ApiError("NOT_CONFIGURED");
    allowed.add(configured.origin);
  }
  if (!origin || !allowed.has(origin)) throw new ApiError("INVALID_ORIGIN");
}

/** Count actual UTF-8 bytes, even when Content-Length is absent or dishonest. */
export async function readJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Invalid body limit");
  const mediaType = request.headers.get("content-type")?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new ApiError("BAD_JSON");
    if (Number(length) > maxBytes) throw new ApiError("PAYLOAD_TOO_LARGE");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("BAD_JSON");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        // Do not await a potentially stalled producer's cancellation promise.
        void reader.cancel().catch(() => {});
        throw new ApiError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("BAD_JSON");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ApiError("BAD_JSON"); }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ApiError("INVALID_INPUT");
  return value as Record<string, unknown>;
}

type UpstreamError = { message?: string; code?: string; status?: number; name?: string };
export function rpcError(error: UpstreamError): ApiError {
  const messages: Record<string, FailureCode> = {
    unauthorized: "UNAUTHORIZED", forbidden: "FORBIDDEN", not_authorized: "FORBIDDEN",
    not_found: "NOT_FOUND", version_conflict: "CONFLICT", idempotency_conflict: "CONFLICT",
    forbidden_transition: "CONFLICT", rate_limit: "RATE_LIMITED",
    invalid_input: "INVALID_INPUT", invalid_action: "INVALID_INPUT",
    invalid_experiment: "INVALID_INPUT", invalid_observation: "INVALID_INPUT",
    invalid_parent: "INVALID_INPUT", material_limit: "INVALID_INPUT",
  };
  // Own-property lookup: arbitrary upstream text must not resolve Object.prototype keys.
  const message = error.message?.trim() ?? "";
  if (Object.hasOwn(messages, message)) return new ApiError(messages[message]);
  if (error.code === "42501") return new ApiError("FORBIDDEN");
  if (["22P02", "22023", "23502", "23514"].includes(error.code ?? ""))
    return new ApiError("INVALID_INPUT");
  return new ApiError("UNAVAILABLE");
}

export function authError(error: UpstreamError): ApiError {
  if (error.status === 429 || error.code === "over_request_rate_limit") return new ApiError("RATE_LIMITED");
  if (error.name === "AuthSessionMissingError" ||
      ["session_not_found", "session_expired", "refresh_token_not_found", "refresh_token_already_used", "bad_jwt", "invalid_credentials"].includes(error.code ?? "") ||
      [400, 401, 403].includes(error.status ?? 0))
    return new ApiError("UNAUTHORIZED");
  return new ApiError("UNAVAILABLE");
}
