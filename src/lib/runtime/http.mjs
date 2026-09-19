/** Application errors only contain safe, public messages, never model or DB payloads. */
export class AppError extends Error {
  /** @param {string} code @param {number} status @param {string} message */
  constructor(code, status, message) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

/** @param {unknown} value @returns {Record<string, unknown>} */
export function object(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new AppError("invalid_input", 422, "입력 내용을 확인해 주세요.");
  return /** @type {Record<string, unknown>} */ (value);
}

/** Exact allowlist: a proxy Host header must not broaden a configured origin. */
/** @param {Request} request @param {string} requestOrigin @param {string | undefined} configuredOrigin */
export function requireOrigin(request, requestOrigin, configuredOrigin) {
  let expected;
  try {
    const url = new URL(configuredOrigin || requestOrigin);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || url.pathname !== "/") throw new Error();
    expected = url.origin;
  } catch {
    throw new AppError("configuration_error", 503, "서비스 연결 설정을 확인하고 있어요.");
  }
  if (request.headers.get("origin") !== expected)
    throw new AppError("origin_denied", 403, "허용되지 않은 요청이에요.");
}

/** Bound the actual UTF-8 bytes, not just Content-Length. Cancel slow/oversized streams. */
/** @param {Request} request @param {{maxBytes?: number, timeoutMs?: number}} [options] */
export async function readJson(request, { maxBytes = 128 * 1024, timeoutMs = 10_000 } = {}) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    throw new AppError("unsupported_media_type", 415, "JSON 형식으로 요청해 주세요.");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))))
    throw new AppError("invalid_length", 400, "요청 형식을 확인해 주세요.");
  if (declared !== null && Number(declared) > maxBytes)
    throw new AppError("body_too_large", 413, "입력 용량이 너무 커요.");
  if (!request.body) throw new AppError("invalid_json", 400, "요청 본문이 필요해요.");
  const reader = request.body.getReader();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AppError("request_timeout", 408, "요청 수신 시간이 초과됐어요.")), timeoutMs);
  });
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, text = "";
    for (;;) {
      const part = await Promise.race([reader.read(), timeout]);
      const { done, value } = /** @type {ReadableStreamReadResult<Uint8Array>} */ (part);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new AppError("body_too_large", 413, "입력 용량이 너무 커요.");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return /** @type {unknown} */ (JSON.parse(text));
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError("invalid_json", 400, "요청 본문의 JSON 형식을 확인해 주세요.");
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

/** Map known DB contracts only. Unknown failures are not student input errors. */
/** @param {unknown} value @returns {AppError} */
export function rpcError(value) {
  const e = value && typeof value === "object" ? /** @type {Record<string, unknown>} */ (value) : {};
  const message = String(e.message || "");
  if (/^(version_conflict|idempotency_conflict)$/.test(message))
    return new AppError(message, 409, "다른 화면에서 기록이 바뀌었어요. 새로고침 후 확인해 주세요.");
  if (message === "rate_limit") return new AppError("rate_limit", 429, "요청이 많아요. 잠시 후 다시 보내주세요.");
  if (message === "unauthorized") return new AppError("unauthorized", 401, "로그인해 주세요.");
  if (["forbidden", "not_authorized"].includes(message)) return new AppError("forbidden", 403, "이 작업에 접근할 권한이 없어요.");
  if (message === "not_found") return new AppError("not_found", 404, "기록을 찾을 수 없어요.");
  if (message === "forbidden_transition") return new AppError("invalid_transition", 409, "현재 단계에서는 처리할 수 없어요. 기록을 다시 확인해 주세요.");
  if (/^(invalid_input|invalid_action|invalid_experiment|invalid_observation|invalid_parent|material_limit)$/.test(message) ||
      ["22P02", "23502", "23514"].includes(String(e.code)))
    return new AppError("invalid_input", 422, "입력 내용과 수업 조건을 확인해 주세요.");
  if (["PGRST000", "PGRST001", "PGRST002", "PGRST003", "57014"].includes(String(e.code)))
    return new AppError("database_unavailable", 503, "저장소 연결이 원활하지 않아요. 다시 시도해 주세요.");
  return new AppError("internal_error", 500, "처리를 완료하지 못했어요. 같은 요청으로 다시 시도해 주세요.");
}

/** @param {unknown} error @param {string} requestId */
export function publicFailure(error, requestId) {
  const e = error instanceof AppError ? error : new AppError("internal_error", 500, "처리를 완료하지 못했어요. 다시 시도해 주세요.");
  /** @type {Record<string, string>} */
  const headers = {};
  if (e.status === 429) headers["Retry-After"] = "60";
  return {
    status: e.status,
    body: { error: e.message, code: e.code, request_id: requestId },
    headers,
  };
}
