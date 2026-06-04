/** Server-only SF Open311 credentials and endpoint URLs.
 *  SF 311 portal labels: API Key ID + API Key Secret.
 *  Map to SF_OPEN311_APP_TOKEN and SF_OPEN311_SECRET_TOKEN respectively.
 */
export function getSf311Config() {
  const appToken = process.env.SF_OPEN311_APP_TOKEN;
  const secretToken = process.env.SF_OPEN311_SECRET_TOKEN;
  const servicesUrl =
    process.env.SF_OPEN311_SERVICES_URL ??
    'https://san-francisco2-production.spotmobile.net/open311/v2/services.json';
  const submitUrl =
    process.env.SF_OPEN311_SUBMIT_URL ??
    'https://mobile311.sfgov.org/open311/v2/requests.json';
  const apiBaseUrl =
    process.env.SF_OPEN311_API_BASE_URL ??
    'https://mobile311.sfgov.org/open311/v2';

  return { appToken, secretToken, servicesUrl, submitUrl, apiBaseUrl };
}

/** When false (default), submitTo311 returns a mock ID without calling SF. Set SF_OPEN311_LIVE=true to enable real POST. */
export function isSf311LiveSubmitEnabled(): boolean {
  const raw = process.env.SF_OPEN311_LIVE?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function getSf311SubmitDiagnostics() {
  const { appToken, secretToken, submitUrl } = getSf311Config();
  return {
    liveRaw: process.env.SF_OPEN311_LIVE ?? null,
    liveEnabled: isSf311LiveSubmitEnabled(),
    configured: Boolean(appToken && secretToken),
    submitUrl,
  };
}

/** Auth for all Open311 calls (reads and writes). */
export function sf311AuthHeaders(): Record<string, string> {
  const { appToken, secretToken } = getSf311Config();
  if (!appToken || !secretToken) {
    throw new Error('SF Open311 credentials are not configured');
  }

  const basic = Buffer.from(`${appToken}:${secretToken}`).toString('base64');
  return {
    'X-App-Token': appToken,
    Authorization: `Basic ${basic}`,
  };
}

/** @deprecated Use sf311AuthHeaders — submit uses the same Basic + X-App-Token scheme. */
export function sf311SubmitAuthHeaders(): Record<string, string> {
  return sf311AuthHeaders();
}

export function isSf311Configured(): boolean {
  const { appToken, secretToken } = getSf311Config();
  return Boolean(appToken && secretToken);
}
