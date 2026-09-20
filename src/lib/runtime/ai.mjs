/** Reject a hypothesis without a verbatim reason span. Schema parsing happens first. */
/** @param {{hypothesis: string, reason_status: string, evidence: string}} proposal @param {string} reason */
export function validateEvidence(proposal, reason) {
  const { hypothesis, reason_status, evidence } = proposal;
  if (evidence && (!evidence.trim() || !reason.includes(evidence))) throw new Error("invalid_evidence");
  if (hypothesis !== "hold" && (!evidence.trim() || reason_status === "insufficient"))
    throw new Error("unsupported_hypothesis");
  return proposal;
}

/** RPC false is a rejected/stale lease, not a persisted result. */
/** @param {{data: unknown, error: unknown}} result @returns {"applied" | "stale"} */
export function finishOutcome(result) {
  if (result.error) throw new Error("finish_unconfirmed");
  if (result.data === true) return "applied";
  if (result.data === false) return "stale";
  throw new Error("invalid_finish_response");
}

/** @typedef {{id: string, title: string, section?: string, content: string}} Material */
/** @typedef {Material & {material_id: string, start: number, end: number, score: number}} Chunk */
/**
 * Deterministic whole-document lexical retrieval. This is NOT semantic/vector search.
 * Offsets are JavaScript UTF-16 string offsets, directly usable with source.slice(start,end).
 * @param {string} question @param {Material[]} materials
 * @param {{chunkSize?: number, overlap?: number, limit?: number}} [options]
 * @returns {Chunk[]}
 */
export function retrieveChunks(question, materials, { chunkSize = 1200, overlap = 200, limit = 3 } = {}) {
  if (!Number.isInteger(chunkSize) || chunkSize < 10 || !Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize ||
      !Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("invalid_retrieval_options");
  const tokens = [...new Set(question.toLocaleLowerCase("ko-KR").match(/[\p{L}\p{N}]+/gu) || [])].filter((x) => x.length > 1);
  if (!tokens.length) return [];
  /** @type {Chunk[]} */
  const chunks = [];
  for (const material of materials) {
    for (let start = 0; start < material.content.length; start += chunkSize - overlap) {
      // Do not split a Unicode surrogate pair at either boundary.
      let from = start, end = Math.min(material.content.length, start + chunkSize);
      if (from && /[\uDC00-\uDFFF]/.test(material.content[from])) from--;
      if (end < material.content.length && /[\uDC00-\uDFFF]/.test(material.content[end])) end--;
      const content = material.content.slice(from, end), lower = content.toLocaleLowerCase("ko-KR");
      const bodyScore = tokens.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0);
      if (bodyScore > 0) {
        const title = material.title.toLocaleLowerCase("ko-KR");
        const score = bodyScore * 4 + tokens.reduce((sum, token) => sum + (title.includes(token) ? 1 : 0), 0);
        chunks.push({ ...material, id: `${material.id}:${from}:${end}`, material_id: material.id, content, start: from, end, score });
      }
      if (end >= material.content.length) break;
    }
  }
  chunks.sort((a, b) => b.score - a.score || a.material_id.localeCompare(b.material_id) || a.start - b.start);
  /** @type {Chunk[]} */
  const selected = [];
  for (const candidate of chunks) {
    if (selected.some((s) => s.material_id === candidate.material_id &&
        Math.max(0, Math.min(s.end, candidate.end) - Math.max(s.start, candidate.start)) > Math.min(s.content.length, candidate.content.length) / 2)) continue;
    selected.push(candidate);
    if (selected.length === limit) break;
  }
  return selected;
}

/** @param {{supported: boolean, links: string[], citations: {id: string, quote: string}[]}} result @param {Chunk[]} candidates */
export function courseSources(result, candidates) {
  if (result.links.length || (result.supported && !result.citations.length) ||
      (!result.supported && result.citations.length)) throw new Error("missing_evidence");
  const used = new Set();
  return result.citations.map((citation) => {
    const source = candidates.find((m) => m.id === citation.id);
    if (!source || !citation.quote.trim() || !source.content.includes(citation.quote)) throw new Error("invalid_citation");
    const key = citation.id + "\0" + citation.quote;
    if (used.has(key)) throw new Error("duplicate_citation");
    used.add(key);
    const offset = source.content.indexOf(citation.quote);
    return { title: source.title, section: source.section || "", quote: citation.quote,
      material_id: source.material_id, start: source.start + offset, end: source.start + offset + citation.quote.length };
  });
}

/**
 * Keep persistence uncertainty separate from inference failure. Do not replace a
 * successfully generated answer with an error answer when the DB acknowledgement is lost.
 * @param {(name: string, args: Record<string, unknown>) => PromiseLike<{data: unknown, error: unknown}>} rpc
 * @param {string} name @param {Record<string, unknown>} args
 * @returns {Promise<"applied" | "stale" | "unconfirmed">}
 */
export async function persistCompletion(rpc, name, args) {
  try { return finishOutcome(await rpc(name, args)); }
  catch { return "unconfirmed"; }
}

/** Generate first, then persist exactly once. An acknowledgement failure must
 * never be handled as an inference failure and overwrite an accepted answer.
 * @param {{rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{data: unknown, error: unknown}>,
 * name: string, generate: () => Promise<Record<string, unknown>>, fallback: Record<string, unknown>}} options
 */
export async function completeLegacyJob({ rpc, name, generate, fallback }) {
  let args;
  let generated = true;
  try { args = await generate(); }
  catch { args = fallback; generated = false; }
  const outcome = await persistCompletion(rpc, name, args);
  return { generated, outcome };
}
