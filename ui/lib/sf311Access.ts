import { getSf311Config, isSf311Configured, sf311AuthHeaders } from './sf311Config';

export type Sf311AccessProbe = {
  ok: boolean;
  status: number;
  message: string;
};

export type Sf311AccessReport = {
  configured: boolean;
  canRead: boolean;
  canWrite: boolean;
  readProbe: Sf311AccessProbe | null;
  writeProbe: Sf311AccessProbe | null;
  /** What to do when read works but write returns 403. */
  fix: string | null;
};

const WRITE_ACCESS_FIX =
  'SF discontinued third-party Open311 submit access (July 2025). POST /requests.json returns 403 for all keys — ' +
  'this is not fixable by rotating API credentials. For a programmatic path, contact SF 311: ' +
  'carson.chin@sfgov.org (Deputy Director, per Open311 sunset notice) or call 311 / 415-701-2311. ' +
  'Until then use SF_OPEN311_LIVE=false for mock submits in dev.';

/** Probe read (GET requests) and write (POST requests) separately. */
export async function verifySf311Access(): Promise<Sf311AccessReport> {
  if (!isSf311Configured()) {
    return {
      configured: false,
      canRead: false,
      canWrite: false,
      readProbe: null,
      writeProbe: null,
      fix: 'Set SF_OPEN311_APP_TOKEN (API Key ID) and SF_OPEN311_SECRET_TOKEN (API Key Secret).',
    };
  }

  const { appToken, submitUrl, apiBaseUrl } = getSf311Config();
  const headers = sf311AuthHeaders();

  let readProbe: Sf311AccessProbe | null = null;
  try {
    const res = await fetch(
      `${apiBaseUrl}/requests.json?per_page=1&api_key=${encodeURIComponent(appToken!)}`,
      { headers }
    );
    const text = await res.text();
    readProbe = { ok: res.ok, status: res.status, message: text.slice(0, 160) };
  } catch (err) {
    readProbe = {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : 'Read probe failed',
    };
  }

  let writeProbe: Sf311AccessProbe | null = null;
  try {
    const body = new URLSearchParams({
      api_key: appToken!,
      service_code: 'input:Pothole & Street Issues',
      description: 'CivicPulse write-access probe — please ignore and close',
      lat: '37.7749',
      long: '-122.4194',
      address_string: 'San Francisco',
      first_name: 'CivicPulse',
      last_name: 'User',
      email: 'report@civicpulse.app',
    });
    const res = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const text = await res.text();
    writeProbe = { ok: res.ok, status: res.status, message: text.slice(0, 160) };
  } catch (err) {
    writeProbe = {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : 'Write probe failed',
    };
  }

  const canRead = readProbe?.ok === true;
  const canWrite = writeProbe?.ok === true;

  let fix: string | null = null;
  if (!canRead) {
    fix =
      'Check SF_OPEN311_APP_TOKEN and SF_OPEN311_SECRET_TOKEN. Auth uses Basic base64(id:secret) plus X-App-Token.';
  } else if (!canWrite) {
    fix = WRITE_ACCESS_FIX;
  }

  return {
    configured: true,
    canRead,
    canWrite,
    readProbe,
    writeProbe,
    fix,
  };
}

export function formatSf311WriteAccessError(status: number, detail: string): string {
  if (status === 403) {
    return `${detail} ${WRITE_ACCESS_FIX}`;
  }
  return detail;
}
