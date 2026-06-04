#!/usr/bin/env node
/**
 * Probes SF Open311 read vs write access using env from .env.local.
 * Run from ui/: npm run test:311
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');

for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq);
  let val = trimmed.slice(eq + 1);
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  process.env[key] = val;
}

const appToken = process.env.SF_OPEN311_APP_TOKEN;
const secretToken = process.env.SF_OPEN311_SECRET_TOKEN;
const submitUrl =
  process.env.SF_OPEN311_SUBMIT_URL ??
  'https://mobile311.sfgov.org/open311/v2/requests.json';
const apiBaseUrl =
  process.env.SF_OPEN311_API_BASE_URL ??
  'https://mobile311.sfgov.org/open311/v2';

if (!appToken || !secretToken) {
  console.error('Missing SF_OPEN311_APP_TOKEN or SF_OPEN311_SECRET_TOKEN in .env.local');
  process.exit(1);
}

const basic = 'Basic ' + Buffer.from(`${appToken}:${secretToken}`).toString('base64');
const headers = { Authorization: basic, 'X-App-Token': appToken };

const readRes = await fetch(
  `${apiBaseUrl}/requests.json?per_page=1&api_key=${encodeURIComponent(appToken)}`,
  { headers }
);
const readText = await readRes.text();

const writeBody = new URLSearchParams({
  api_key: appToken,
  service_code: 'input:Pothole & Street Issues',
  description: 'CivicPulse write-access probe — please ignore and close',
  lat: '37.7749',
  long: '-122.4194',
  address_string: 'San Francisco',
  first_name: 'CivicPulse',
  last_name: 'User',
  email: 'report@civicpulse.app',
});
const writeRes = await fetch(submitUrl, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: writeBody,
});
const writeText = await writeRes.text();

const report = {
  canRead: readRes.ok,
  canWrite: writeRes.ok,
  readProbe: { status: readRes.status, message: readText.slice(0, 160) },
  writeProbe: { status: writeRes.status, message: writeText.slice(0, 160) },
  fix: !writeRes.ok
    ? 'SF Open311 POST is disabled (API sunset July 2025). Contact carson.chin@sfgov.org or call 311. Use SF_OPEN311_LIVE=false for dev mocks.'
    : null,
};

console.log(JSON.stringify(report, null, 2));

const live = process.env.SF_OPEN311_LIVE?.trim().toLowerCase();
const liveEnabled = live === 'true' || live === '1' || live === 'yes';
if (!liveEnabled) {
  console.error('\nPOC mode (SF_OPEN311_LIVE=false): mock submits OK; write probe failure is expected.');
  process.exit(report.canRead ? 0 : 1);
}

process.exit(report.canWrite ? 0 : 1);
