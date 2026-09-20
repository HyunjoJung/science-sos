import { AppError, object } from "./http.mjs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** @returns {never} */
function invalid() { throw new AppError("invalid_input", 422, "입력값의 형식과 길이를 확인해 주세요."); }
/** @param {unknown} value @param {boolean} [nullable] */
export function uuid(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !UUID.test(value)) return invalid();
  return value;
}
/** @param {unknown} value @param {number} max @param {boolean} [empty] */
export function text(value, max, empty = false) {
  if (typeof value !== "string") return invalid();
  const result = value.trim();
  if ((!empty && !result) || [...result].length > max) return invalid();
  return result;
}
/** @param {Record<string, unknown>} data @param {string[]} keys */
function keysOnly(data, keys) { if (Object.keys(data).some((key) => !keys.includes(key))) invalid(); }
/** @param {unknown} value @param {string[]} choices */
function oneOf(value, choices) { if (typeof value !== "string" || !choices.includes(value)) return invalid(); return value; }
/** @param {Record<string, unknown>} data @param {string} key @param {number} max */
function optionalText(data, key, max) { if (key in data) data[key] = text(data[key], max, true); }
/** @typedef {{action: string, id: string | null, version: number | null, request: string, data: Record<string, unknown>}} Command */
/** @param {unknown} raw @returns {Command} */
function envelope(raw) {
  const body = object(raw);
  keysOnly(body, ["action", "id", "version", "request", "data"]);
  const data = { ...object(body.data) };
  if (typeof body.action !== "string") return invalid();
  const request = uuid(body.request);
  const id = uuid(body.id, true);
  const version = body.version === undefined ? null : body.version;
  if (version !== null && (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1)) return invalid();
  return { action: body.action, id, version: /** @type {number | null} */ (version), request: /** @type {string} */ (request), data };
}

/** API defense in depth. The database must independently enforce these rules for direct RPC. */
/** @param {unknown} raw @returns {Command} */
export function labCommand(raw) {
  const c = envelope(raw), d = c.data;
  if (c.action === "submit") {
    if (c.id !== null || c.version !== null) invalid();
    keysOnly(d, ["item", "prediction", "reason", "stuck", "note", "difficult"]);
    d.item = text(d.item, 80); d.prediction = text(d.prediction, 150); d.reason = text(d.reason, 300);
    optionalText(d, "stuck", 50); optionalText(d, "note", 300);
    if ("difficult" in d && typeof d.difficult !== "boolean") invalid();
    return c;
  }
  if (c.id === null || c.version === null) invalid();
  switch (c.action) {
    case "reason": keysOnly(d, ["reason"]); d.reason = text(d.reason, 300); break;
    case "review":
      keysOnly(d, ["decision", "question", "hypothesis", "experiment", "review_note"]);
      optionalText(d, "question", 500); optionalText(d, "review_note", 300);
      if (d.decision === "hold") {
        // The current Review form submits all controls; discard inactive fields.
        delete d.hypothesis; delete d.experiment; delete d.review_note;
      } else {
        delete d.question;
        oneOf(d.decision, ["confirm", "edit"]);
        oneOf(d.hypothesis, ["mass_only", "size_only", "liquid_missed", "other"]);
        oneOf(d.experiment, ["wood80_iron20", "split_wood", "change_liquid", "guided"]);
        optionalText(d, "review_note", 300);
      }
      break;
    case "observe": keysOnly(d, ["observation"]); if ("observation" in d) d.observation = text(d.observation, 500); break;
    case "revise":
      keysOnly(d, ["text", "note", "stuck"]); d.text = text(d.text, 300);
      optionalText(d, "note", 200); oneOf(d.stuck, ["predict", "observe", "rewrite", "none"]); break;
    case "reassess":
      keysOnly(d, ["prediction", "reason"]); d.prediction = text(d.prediction, 150); d.reason = text(d.reason, 300); break;
    case "complete":
      keysOnly(d, ["scores"]);
      if (!Array.isArray(d.scores) || d.scores.length !== 3 || d.scores.some((n) => typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 2)) invalid();
      break;
    default: invalid();
  }
  return c;
}

/** @param {unknown} raw @returns {Command} */
export function spaceCommand(raw) {
  const c = envelope(raw), d = c.data;
  const creates = ["material_add", "chat_send", "topic_add"];
  if ((creates.includes(c.action) && c.id !== null) ||
      (!creates.includes(c.action) && c.action !== "feedback_send" && c.id === null)) invalid();
  if (c.version !== null) invalid();
  switch (c.action) {
    case "material_add":
      keysOnly(d, ["title", "section", "content"]);
      d.title = text(d.title, 120); d.content = text(d.content, 30_000); optionalText(d, "section", 100); break;
    case "material_edit":
      keysOnly(d, ["content", "enabled"]);
      if (!("content" in d) && !("enabled" in d)) invalid();
      if ("content" in d) d.content = text(d.content, 30_000);
      if ("enabled" in d && typeof d.enabled !== "boolean") invalid(); break;
    case "feedback_send":
      keysOnly(d, ["student_id", "body"]); uuid(d.student_id); d.body = text(d.body, 1500); break;
    case "feedback_read": case "like_toggle": keysOnly(d, []); break;
    case "chat_send":
      keysOnly(d, ["room", "question"]); oneOf(d.room, ["course", "external"]); d.question = text(d.question, 500); break;
    case "topic_add":
      keysOnly(d, ["title", "unit"]); d.title = text(d.title, 180); d.unit = text(d.unit, 80); break;
    case "post_add":
      keysOnly(d, ["body", "parent_id"]); d.body = text(d.body, 1500); if ("parent_id" in d) uuid(d.parent_id, true); break;
    default: invalid();
  }
  return c;
}
