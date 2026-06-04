import { AgentRun } from '@shared/types';
import { runCivicAgent } from './agent';
import { evaluateReviewGate } from './reviewGate';
import { resolveReportCoordinates } from './resolveReportLocation';
import { getSubmitContextFromRun, submitTo311, Submit311Error } from './submit311';
import { isSf311LiveSubmitEnabled } from './sf311Config';

export async function finishAgentRun(
  run: AgentRun,
  input: { text?: string; lat: number; lng: number; photoUrl?: string }
): Promise<AgentRun> {
  const resolved = await resolveReportCoordinates({
    text: input.text,
    lat: input.lat,
    lng: input.lng,
  });

  const result = await runCivicAgent({
    text: input.text,
    lat: resolved.lat,
    lng: resolved.lng,
    photoUrl: input.photoUrl,
  });

  const steps = result.toolResults.map((tr, i) => ({
    id: `step-${i}`,
    name: tr.tool,
    status: 'complete' as const,
    output: tr.result as Record<string, unknown>,
    timestamp: new Date(),
  }));

  const gate = evaluateReviewGate(result.toolResults);
  const locationGeocodeFailed = resolved.geocodeFailed === true;
  const needsReview = gate.needsReview || locationGeocodeFailed;

  let updated: AgentRun = {
    ...run,
    input: {
      ...run.input,
      text: input.text,
      lat: input.lat,
      lng: input.lng,
    },
    status: 'complete',
    steps,
    draft: result.text,
    needsReview,
    confidence: gate.confidence,
    severity: gate.severity,
    draftPayload: gate.draftPayload,
    locationSource: resolved.source,
    locationMention: resolved.mention,
    locationGeocodeFailed,
    serviceRequestId: undefined,
    submission: undefined,
  };

  if (!needsReview) {
    try {
      const { payload, city } = getSubmitContextFromRun(updated);
      const submitted = await submitTo311(payload, city);

      if (submitted.mock && isSf311LiveSubmitEnabled()) {
        throw new Submit311Error(
          'SF_OPEN311_LIVE is true but submit ran as mock. Restart dev server from ui/ and check GET /api/test/311-status.',
          'submit_failed'
        );
      }

      updated = {
        ...updated,
        needsReview: false,
        serviceRequestId: submitted.serviceRequestId,
        submission: submitted.mock ? 'mock' : 'auto',
      };
    } catch (err) {
      if (err instanceof Submit311Error) {
        updated = {
          ...updated,
          status: 'error',
          needsReview: false,
          serviceRequestId: undefined,
          submission: undefined,
          steps: [
            ...updated.steps,
            {
              id: 'submit-error',
              name: '311 Submit Error',
              status: 'error',
              error: err.message,
              timestamp: new Date(),
            },
          ],
        };
      } else {
        throw err;
      }
    }
  }

  return updated;
}
