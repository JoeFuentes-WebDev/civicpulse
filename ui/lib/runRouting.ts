import { AgentRun } from '@shared/types';

/** High-confidence run that was already submitted during /api/run. */
export function isAutoSubmitted(run: AgentRun): boolean {
  return (
    run.status === 'complete' &&
    run.needsReview === false &&
    Boolean(run.serviceRequestId) &&
    (run.submission === 'auto' || run.submission === 'mock')
  );
}
