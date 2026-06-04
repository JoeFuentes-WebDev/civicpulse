import { DraftSubmissionPayload } from '@shared/types';

export const AUTO_SUBMIT_MIN_CONFIDENCE = 0.8;
export const AUTO_SUBMIT_MAX_SEVERITY = 3;

export type ClassifyReportOutput = {
  category: string;
  service_code: string;
  severity: number;
  confidence: number;
  reasoning?: string;
  location_mention?: string | null;
  is_different_location?: boolean;
};

export type AgentToolResult = {
  tool: string;
  result: unknown;
};

export type ReviewGateResult = {
  needsReview: boolean;
  confidence: number;
  severity: number;
  classify?: ClassifyReportOutput;
  draftPayload?: DraftSubmissionPayload;
  /** Human-readable reasons when needsReview is true. */
  reasons: string[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function findToolResult(
  toolResults: AgentToolResult[],
  toolName: string
): unknown | undefined {
  return toolResults.find(tr => tr.tool === toolName)?.result;
}

function parseClassifyOutput(raw: unknown): ClassifyReportOutput | undefined {
  const o = asRecord(raw);
  if (!o) return undefined;

  const confidence = o.confidence;
  const severity = o.severity;
  const category = o.category;
  const service_code = o.service_code;

  if (
    typeof confidence !== 'number' ||
    typeof severity !== 'number' ||
    typeof category !== 'string' ||
    typeof service_code !== 'string'
  ) {
    return undefined;
  }

  return {
    category,
    service_code,
    severity,
    confidence,
    reasoning: typeof o.reasoning === 'string' ? o.reasoning : undefined,
    location_mention:
      o.location_mention === null || typeof o.location_mention === 'string'
        ? o.location_mention
        : undefined,
    is_different_location:
      typeof o.is_different_location === 'boolean'
        ? o.is_different_location
        : undefined,
  };
}

function parseDraftPayload(raw: unknown): DraftSubmissionPayload | undefined {
  const o = asRecord(raw);
  if (!o) return undefined;

  const required = [
    'service_code',
    'description',
    'lat',
    'lng',
    'address_string',
    'severity',
    'category',
    'first_name',
    'last_name',
    'email',
    'submitted_at',
  ] as const;

  for (const key of required) {
    if (o[key] === undefined || o[key] === null) return undefined;
  }

  if (
    typeof o.lat !== 'number' ||
    typeof o.lng !== 'number' ||
    typeof o.severity !== 'number'
  ) {
    return undefined;
  }

  return o as unknown as DraftSubmissionPayload;
}

/**
 * Decide whether the user must review before 311 submit.
 * Safe default: needsReview when classification or draft is missing/invalid.
 */
export function evaluateReviewGate(
  toolResults: AgentToolResult[]
): ReviewGateResult {
  const reasons: string[] = [];

  const classify = parseClassifyOutput(
    findToolResult(toolResults, 'classify_report')
  );
  const draftPayload = parseDraftPayload(
    findToolResult(toolResults, 'draft_submission')
  );

  if (!classify) {
    reasons.push('classification_missing');
  }

  if (!draftPayload) {
    reasons.push('draft_missing');
  }

  const confidence = classify?.confidence ?? 0;
  const severity = classify?.severity ?? 5;

  if (classify && confidence < AUTO_SUBMIT_MIN_CONFIDENCE) {
    reasons.push('low_confidence');
  }

  if (classify && severity > AUTO_SUBMIT_MAX_SEVERITY) {
    reasons.push('high_severity');
  }

  const needsReview = reasons.length > 0;

  return {
    needsReview,
    confidence,
    severity,
    classify,
    draftPayload,
    reasons,
  };
}
