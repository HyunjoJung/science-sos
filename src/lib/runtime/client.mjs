import { AppError } from "./http.mjs";

/** Stable JSON canonicalization; preserves array order and rejects ambiguous values. */
/** @param {unknown} value @returns {string} */
export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(/** @type {Record<string, unknown>} */ (value)[k])).join(",") + "}";
  throw new AppError("invalid_input", 422, "전송할 데이터 형식을 확인해 주세요.");
}
/** @param {string} text */
async function digest(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** @typedef {{id?: string, ok?: boolean}} MutationResult */
/**
 * A pending request retains its UUID after a timeout, unreadable response or 5xx.
 * Only opaque SHA-256 fingerprints and UUIDs go to sessionStorage, never answers/passwords.
 * No automatic retries of writes; repeating the same command is an explicit user action.
 * @param {{fetchFn?: typeof fetch, storage?: () => Storage | null, timeoutMs?: number, maxPending?: number}} [options]
 */
export function createMutationClient({ fetchFn = fetch, storage = () => null, timeoutMs = 15_000, maxPending = 64 } = {}) {
  /** @type {Map<string, string>} */
  const pending = new Map();
  /** @type {Map<string, Promise<MutationResult>>} */
  const running = new Map();
  const prefix = "science-sos:pending:v1:";
  function getStorage() { try { return storage(); } catch { return null; } }
  /** @param {string} key */
  function getId(key) {
    if (pending.has(key)) return /** @type {string} */ (pending.get(key));
    const store = getStorage();
    let saved = null;
    try { saved = store?.getItem(prefix + key) ?? null; } catch { /* memory fallback */ }
    if (saved && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved))
      throw new AppError("pending_state_invalid", 409, "이전 요청의 상태를 확인하지 못했어요. 저장 기록을 먼저 확인해 주세요.");
    let count = pending.size;
    try {
      if (store) {
        const keys = new Set([...pending.keys()].map((k) => prefix + k));
        for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k?.startsWith(prefix)) keys.add(k); }
        count = keys.size;
      }
    } catch { /* memory fallback */ }
    // Never evict unresolved writes: doing so could generate a duplicate request.
    if (!saved && count >= maxPending)
      throw new AppError("pending_limit", 409, "확인하지 못한 저장 요청이 많아요. 기존 요청부터 다시 확인해 주세요.");
    const id = saved || crypto.randomUUID();
    pending.set(key, id);
    try { store?.setItem(prefix + key, id); } catch { /* still safe for this page lifetime */ }
    return id;
  }
  /** @param {string} key */
  function forget(key) { pending.delete(key); try { getStorage()?.removeItem(prefix + key); } catch {} }
  /** @param {string} endpoint @param {Record<string, unknown>} body */
  async function transmit(endpoint, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(endpoint, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal,
      });
      let result;
      try { result = await response.json(); }
      catch { throw new AppError("response_unknown", 503, "저장 결과를 확인하지 못했어요. 같은 내용으로 다시 눌러 확인해 주세요."); }
      if (!response.ok) {
        const message = result && typeof result.error === "string" ? result.error.slice(0, 300) : "저장을 완료하지 못했어요.";
        throw new AppError(typeof result?.code === "string" ? result.code : "request_failed", response.status, message);
      }
      const isAuth = body.action === "login" || body.action === "logout";
      const isId = typeof result?.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.id);
      if (!result || typeof result !== "object" || (isAuth ? result.ok !== true : !isId))
        throw new AppError("response_unknown", 503, "저장 결과를 확인하지 못했어요. 같은 내용으로 다시 눌러 확인해 주세요.");
      return /** @type {MutationResult} */ (result);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("response_unknown", 503, "연결이 끊겨 저장 결과를 확인하지 못했어요. 같은 내용으로 다시 눌러 확인해 주세요.");
    } finally { clearTimeout(timer); }
  }
  /** @param {string} scope @param {string} endpoint @param {string} action @param {unknown} data @param {string | null} [id] @param {number | null} [version] */
  async function send(scope, endpoint, action, data, id = null, version = null) {
    if (!["/api/lab", "/api/space", "/api/learning"].includes(endpoint))
      throw new AppError("invalid_endpoint", 422, "허용되지 않은 저장 경로예요.");
    // Auth operations are not idempotent RPCs. Never retain their credentials.
    if (action === "login" || action === "logout") return transmit(endpoint, { action, data });
    if (!scope || scope === "guest") throw new AppError("unauthorized", 401, "로그인해 주세요.");
    // Snapshot before hashing/awaiting; caller mutation must not change the transmitted command.
    const command = /** @type {Record<string, unknown>} */ (JSON.parse(canonicalJson({ action, data, id, version })));
    const key = await digest(canonicalJson({ scope, endpoint, ...command }));
    const existing = running.get(key);
    if (existing) return existing;
    const request = getId(key);
    const task = (async () => {
      try {
        const result = await transmit(endpoint, { ...command, request });
        forget(key);
        return result;
      } catch (error) {
        // 408 and 5xx are ambiguous; keep the original request identity.
        if (error instanceof AppError && error.status >= 400 && error.status < 500 && error.status !== 408)
          forget(key);
        throw error;
      } finally { running.delete(key); }
    })();
    running.set(key, task);
    return task;
  }
  return { send };
}

/** Cancellation plus generation fencing, even if an upstream fetch ignores abort. */
export function createLatestRequest() {
  let generation = 0;
  /** @type {AbortController | undefined} */
  let controller;
  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      const ownController = controller, ownGeneration = ++generation;
      return {
        signal: ownController.signal,
        isCurrent: () => ownGeneration === generation && !ownController.signal.aborted,
      };
    },
    cancel() { generation++; controller?.abort(); },
  };
}

/** @param {string} url @param {AbortSignal} signal @param {{fetchFn?: typeof fetch, timeoutMs?: number}} [options] @returns {Promise<any>} */
export async function getJson(url, signal, { fetchFn = fetch, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchFn(url, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
    const result = await response.json();
    if (!response.ok) throw new AppError(typeof result?.code === "string" ? result.code : "read_failed", response.status,
      typeof result?.error === "string" ? result.error.slice(0, 300) : "수업을 불러오지 못했어요.");
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("read_unavailable", 503, "수업 연결이 원활하지 않아요. 다시 불러와 주세요.");
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
