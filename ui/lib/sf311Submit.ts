import { DraftSubmissionPayload } from '@shared/types';
import { getSf311Config, isSf311Configured, sf311AuthHeaders } from './sf311Config';

type ServiceAttribute = {
  code: string;
  required?: boolean;
  datatype?: string;
  values?: { key: string; name: string }[];
};

type ServiceDefinition = {
  service_code: string;
  attributes?: ServiceAttribute[];
};

export async function fetchSf311ServiceDefinition(
  serviceCode: string
): Promise<ServiceDefinition | null> {
  const { appToken, apiBaseUrl } = getSf311Config();
  if (!appToken) return null;

  const url = `${apiBaseUrl}/services/${encodeURIComponent(serviceCode)}.json?api_key=${encodeURIComponent(appToken)}`;
  const res = await fetch(url, { headers: sf311AuthHeaders() });
  if (!res.ok) return null;
  return (await res.json()) as ServiceDefinition;
}

/** Pick required Open311 attribute values from description keywords (POC defaults). */
export function buildRequiredAttributes(
  definition: ServiceDefinition,
  description: string
): Record<string, string> {
  const attrs: Record<string, string> = {};
  const lower = description.toLowerCase();

  for (const attr of definition.attributes ?? []) {
    if (!attr.required || !attr.values?.length) continue;

    const match =
      attr.values.find(v => lower.includes(v.name.toLowerCase())) ??
      attr.values.find(v => lower.includes(v.key.replace(/_/g, ' '))) ??
      attr.values.find(v => v.key === 'other') ??
      attr.values[0];

    attrs[attr.code] = match.key;
  }

  return attrs;
}

export async function postSf311ServiceRequest(
  payload: DraftSubmissionPayload
): Promise<{ serviceRequestId: string; status: string; statusNotes?: string }> {
  if (!isSf311Configured()) {
    throw new Error('SF Open311 credentials are not configured');
  }

  const { appToken, submitUrl } = getSf311Config();
  const definition = await fetchSf311ServiceDefinition(payload.service_code);
  const attributes = definition
    ? buildRequiredAttributes(definition, payload.description)
    : {};

  const body = new URLSearchParams({
    api_key: appToken!,
    service_code: payload.service_code,
    description: payload.description,
    lat: payload.lat.toString(),
    long: payload.lng.toString(),
    address_string: payload.address_string,
    first_name: payload.first_name,
    last_name: payload.last_name,
    email: payload.email,
  });

  for (const [code, value] of Object.entries(attributes)) {
    body.set(`attribute[${code}]`, value);
  }

  const res = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      ...sf311AuthHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Open311 submit failed (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'description' in data &&
      typeof (data as { description: unknown }).description === 'string'
        ? (data as { description: string }).description
        : text.slice(0, 200);
    throw new Error(`Open311 submit failed (${res.status}): ${message}`);
  }

  const record = Array.isArray(data) ? data[0] : data;
  const serviceRequestId =
    record &&
    typeof record === 'object' &&
    'service_request_id' in record &&
    typeof (record as { service_request_id: unknown }).service_request_id === 'string'
      ? (record as { service_request_id: string }).service_request_id
      : null;

  if (!serviceRequestId) {
    throw new Error('Open311 submit succeeded but no service_request_id returned');
  }

  return {
    serviceRequestId,
    status:
      record &&
      typeof record === 'object' &&
      'status' in record &&
      typeof (record as { status: unknown }).status === 'string'
        ? (record as { status: string }).status
        : 'open',
    statusNotes:
      record &&
      typeof record === 'object' &&
      'status_notes' in record &&
      typeof (record as { status_notes: unknown }).status_notes === 'string'
        ? (record as { status_notes: string }).status_notes
        : undefined,
  };
}
