import { getCityConfig } from '../config/cities';
import { AgentRun, AgentStep, DraftSubmissionPayload } from '@shared/types';
import { evaluateReviewGate, findToolResult } from './reviewGate';
import {
  getSf311SubmitDiagnostics,
  isSf311Configured,
  isSf311LiveSubmitEnabled,
} from './sf311Config';
import { postSf311ServiceRequest } from './sf311Submit';
import { formatSf311WriteAccessError } from './sf311Access';

export type Submit311ErrorCode =
  | 'unsupported_city'
  | 'missing_draft'
  | 'submit_failed'
  | 'write_access_denied';

export class Submit311Error extends Error {
  code: Submit311ErrorCode;

  constructor(message: string, code: Submit311ErrorCode) {
    super(message);
    this.name = 'Submit311Error';
    this.code = code;
  }
}

export type Submit311Result = {
  serviceRequestId: string;
  city: string;
  status: string;
  statusNotes: string;
  /** True when SF_OPEN311_LIVE is not enabled (mock submit). */
  mock: boolean;
};

function submitTo311Mock(
  payload: DraftSubmissionPayload,
  cityName: string,
  cityId: string
): Submit311Result {
  console.log('[mock 311]', {
    service_code: payload.service_code,
    description: payload.description,
    lat: payload.lat,
    lng: payload.lng,
    address_string: payload.address_string,
  });

  return {
    serviceRequestId: `MOCK-${cityId.toUpperCase()}-${Date.now()}`,
    city: cityName,
    status: 'open',
    statusNotes: 'Mock submit — set SF_OPEN311_LIVE=true for real Open311',
    mock: true,
  };
}

async function submitTo311Live(
  payload: DraftSubmissionPayload,
  cityName: string
): Promise<Submit311Result> {
  const result = await postSf311ServiceRequest(payload);
  return {
    serviceRequestId: result.serviceRequestId,
    city: cityName,
    status: result.status,
    statusNotes: result.statusNotes ?? 'Report received',
    mock: false,
  };
}

/**
 * Submit a drafted report to SF Open311 (live) or mock, controlled by SF_OPEN311_LIVE.
 */
export async function submitTo311(
  payload: DraftSubmissionPayload,
  city: string
): Promise<Submit311Result> {
  const config = getCityConfig(city);

  if (!config) {
    throw new Submit311Error(
      `${city} is not yet supported. Currently serving California cities only.`,
      'unsupported_city'
    );
  }

  const useLive =
    isSf311LiveSubmitEnabled() &&
    isSf311Configured() &&
    config.id === 'san_francisco';

  const diag = getSf311SubmitDiagnostics();
  console.log('[311 submit]', {
    mode: useLive ? 'live' : 'mock',
    ...diag,
    city: config.id,
    service_code: payload.service_code,
  });

  if (useLive) {
    try {
      return await submitTo311Live(payload, config.name);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Submit failed';
      const match = raw.match(/Open311 submit failed \((\d+)\): (.+)/);
      if (match && match[1] === '403') {
        throw new Submit311Error(
          formatSf311WriteAccessError(403, match[2]),
          'write_access_denied'
        );
      }
      throw new Submit311Error(raw, 'submit_failed');
    }
  }

  return submitTo311Mock(payload, config.name, config.id);
}

function toolResultsFromSteps(steps: AgentStep[]) {
  return steps.map(step => ({ tool: step.name, result: step.output }));
}

function cityFromSteps(steps: AgentStep[]): string | undefined {
  const resolve = findToolResult(toolResultsFromSteps(steps), 'resolve_location');
  const record =
    resolve && typeof resolve === 'object' && !Array.isArray(resolve)
      ? (resolve as Record<string, unknown>)
      : undefined;
  const city = record?.city;
  return typeof city === 'string' ? city : undefined;
}

/** Draft payload + city from a completed agent run (steps or stored fields). */
export function getSubmitContextFromRun(run: AgentRun): {
  payload: DraftSubmissionPayload;
  city: string;
} {
  const payload =
    run.draftPayload ??
    evaluateReviewGate(toolResultsFromSteps(run.steps)).draftPayload;

  if (!payload) {
    throw new Submit311Error(
      'No draft submission found for this report.',
      'missing_draft'
    );
  }

  const city = cityFromSteps(run.steps) ?? 'San Francisco';

  return { payload, city };
}
