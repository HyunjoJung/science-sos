/**
 * Subject-independent v2 domain kernel. nextProposal is used by the connected learning worker.
 * The legacy lab_records RPC remains separate; learning_act mirrors the transition contract.
 * The caller must supply authenticated actor/membership data and persist the returned
 * revision atomically. No LLM output grants permission or publishes an activity.
 */
export class LearningError extends Error {}
/** @typedef {"awaiting_review" | "needs_clarification" | "activity_assigned" | "awaiting_transfer" | "awaiting_final_review" | "completed"} Stage */
/** @typedef {{id: string, subject: string, version: string, activities: {id: string, kind: string, approved: boolean}[]}} ContentPack */
/** @typedef {{id: string, classId: string, studentId: string, packId: string, packVersion: string, version: number, stage: Stage, activityId?: string | null}} LearningRecord */
/** @typedef {{userId: string, role: "student" | "teacher", classIds: string[]}} Actor */
/** @typedef {{recordId: string, expectedVersion: number, action: "request_clarification" | "resubmit" | "assign_activity" | "confirm_understanding" | "complete_activity" | "submit_transfer" | "complete", activityId?: string}} LearningCommand */

/** @param {ContentPack} input @returns {Readonly<ContentPack>} */
export function defineContentPack(input) {
  if (!input || typeof input.id !== "string" || !input.id.trim() ||
      typeof input.subject !== "string" || !input.subject.trim() ||
      typeof input.version !== "string" || !/^\d+\.\d+\.\d+$/.test(input.version) ||
      !Array.isArray(input.activities)) throw new LearningError("invalid_pack");
  const ids = new Set();
  for (const activity of input.activities) {
    if (!activity || typeof activity.id !== "string" || !activity.id.trim() || ids.has(activity.id) ||
        typeof activity.kind !== "string" || !activity.kind.trim() || typeof activity.approved !== "boolean")
      throw new LearningError("invalid_activity");
    ids.add(activity.id);
  }
  const pack = structuredClone(input);
  for (const activity of pack.activities) Object.freeze(activity);
  Object.freeze(pack.activities);
  return Object.freeze(pack);
}

/**
 * Correctness, evidence, interpretation and operational failures are separate.
 * An understood answer goes to a transfer check, not a forced remediation.
 * @param {{ruleVerdict: "correct" | "incorrect" | "unknown", evidence: "supported" | "contradictory" | "insufficient", interpretation: "understood" | "misconception" | "uncertain" | "out_of_scope" | "ambiguous_item", runStatus: "succeeded" | "failed" | "pending"}} analysis
 */
export function nextProposal(analysis) {
  if (!analysis || !["correct", "incorrect", "unknown"].includes(analysis.ruleVerdict) ||
      !["supported", "contradictory", "insufficient"].includes(analysis.evidence) ||
      !["understood", "misconception", "uncertain", "out_of_scope", "ambiguous_item"].includes(analysis.interpretation) ||
      !["succeeded", "failed", "pending"].includes(analysis.runStatus)) throw new LearningError("invalid_analysis");
  if (analysis.runStatus !== "succeeded") return { kind: "operational_review", teacherApprovalRequired: true };
  if (["out_of_scope", "ambiguous_item"].includes(analysis.interpretation)) return { kind: "item_review", teacherApprovalRequired: true };
  if (analysis.evidence === "insufficient" || analysis.interpretation === "uncertain") return { kind: "clarification", teacherApprovalRequired: true };
  if (analysis.interpretation === "understood" && analysis.evidence === "supported" && analysis.ruleVerdict !== "incorrect")
    return { kind: "transfer_check", teacherApprovalRequired: true };
  if (analysis.interpretation === "understood") return { kind: "conflicting_evidence_review", teacherApprovalRequired: true };
  return { kind: "activity_proposal", teacherApprovalRequired: true };
}

/** Pure transition. Authorization data MUST come from the server, never the client body. */
/** @param {LearningRecord} record @param {LearningCommand} command @param {Actor} actor @param {Readonly<ContentPack>} pack @returns {LearningRecord} */
export function transition(record, command, actor, pack) {
  if (!record || !command || !actor || !Array.isArray(actor.classIds) || !["teacher", "student"].includes(actor.role) ||
      !actor.classIds.includes(record.classId) || (actor.role === "student" && actor.userId !== record.studentId))
    throw new LearningError("forbidden");
  if (command.recordId !== record.id) throw new LearningError("record_mismatch");
  if (!Number.isSafeInteger(record.version) || record.version < 1 || record.version >= Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(command.expectedVersion) ||
      record.version !== command.expectedVersion) throw new LearningError("version_conflict");
  if (record.packId !== pack.id || record.packVersion !== pack.version) throw new LearningError("content_version_conflict");
  /** @type {Record<LearningCommand['action'], {role: Actor['role'], from: Stage[], to: Stage}>} */
  const transitions = {
    request_clarification: { role: "teacher", from: ["awaiting_review"], to: "needs_clarification" },
    resubmit: { role: "student", from: ["needs_clarification"], to: "awaiting_review" },
    assign_activity: { role: "teacher", from: ["awaiting_review"], to: "activity_assigned" },
    confirm_understanding: { role: "teacher", from: ["awaiting_review"], to: "awaiting_transfer" },
    complete_activity: { role: "student", from: ["activity_assigned"], to: "awaiting_transfer" },
    submit_transfer: { role: "student", from: ["awaiting_transfer"], to: "awaiting_final_review" },
    complete: { role: "teacher", from: ["awaiting_final_review"], to: "completed" },
  };
  const rule = Object.hasOwn(transitions, command.action) ? transitions[command.action] : undefined;
  if (!rule || actor.role !== rule.role || !rule.from.includes(record.stage)) throw new LearningError("forbidden_transition");
  const next = { ...record, version: record.version + 1, stage: rule.to };
  if (command.action === "assign_activity") {
    const activity = pack.activities.find((a) => a.id === command.activityId && a.approved);
    if (!activity) throw new LearningError("unapproved_activity");
    next.activityId = activity.id;
  }
  if (["request_clarification", "confirm_understanding", "resubmit"].includes(command.action)) next.activityId = null;
  return next;
}
