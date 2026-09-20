/**
 * Keep drafts when AI or resource metadata changes. Start a fresh form only when
 * the person, record, workflow step, or the content being answered changes.
 * @param {{user_id:string, course_id:string, role:string}} context
 * @param {{id:string, stage:string, response?:{answer:string,reason:string},
 * activity?:unknown, transfer?:unknown, teacher_feedback?:string,
 * transfer_response?:unknown}} attempt
 */
export function attemptDraftKey(context, attempt) {
  const content = attempt.stage === 'activity_assigned' ? attempt.activity
    : attempt.stage === 'awaiting_transfer' ? attempt.transfer
    : attempt.stage === 'awaiting_final_review' ? attempt.transfer_response
    : attempt.stage === 'needs_clarification' ? attempt.teacher_feedback
    : null;
  return JSON.stringify([
    context.user_id, context.course_id, context.role, attempt.id, attempt.stage,
    attempt.response?.answer, attempt.response?.reason, content,
  ]);
}

/** Preserve an explicit selection, including a newly returned submission id.
 * @param {{id:string}[]} attempts
 * @param {string} selected
 */
export function reconcileAttemptSelection(attempts, selected) {
  return attempts.some(attempt => attempt.id === selected) ? selected : attempts[0]?.id ?? '';
}

/**
 * A failed classroom read is not a failed login. Only a 401 establishes that a
 * session is absent. The migration error is emitted after server-side auth has
 * succeeded; other outages cannot establish or revoke a session.
 * @typedef {'unknown'|'authenticated'|'unauthenticated'} LearningSession
 * @param {LearningSession} previous
 * @param {unknown} error
 * @returns {LearningSession}
 */
export function sessionAfterLearningFailure(previous, error) {
  const failure = error && typeof error === 'object'
    ? /** @type {{status?:number,code?:string}} */ (error) : {};
  if (failure.status === 401) return 'unauthenticated';
  if (failure.status === 503 && failure.code === 'migration_required') return 'authenticated';
  return previous;
}
