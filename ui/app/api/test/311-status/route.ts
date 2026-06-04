import { NextResponse } from 'next/server';
import { getCityConfig } from '../../../../config/cities';
import {
  getSf311Config,
  isSf311Configured,
  isSf311LiveSubmitEnabled,
} from '../../../../lib/sf311Config';
import { verifySf311Access } from '../../../../lib/sf311Access';

/** Dev helper — confirms server sees Open311 env vars and read/write capability. */
export async function GET() {
  const { servicesUrl, submitUrl, appToken, secretToken } = getSf311Config();
  const sfConfig = getCityConfig('San Francisco');
  const access = await verifySf311Access();

  return NextResponse.json({
    liveRaw: process.env.SF_OPEN311_LIVE ?? null,
    liveEnabled: isSf311LiveSubmitEnabled(),
    configured: isSf311Configured(),
    hasAppToken: Boolean(appToken),
    hasSecretToken: Boolean(secretToken),
    servicesUrl,
    submitUrl,
    sfCityId: sfConfig?.id ?? null,
    canRead: access.canRead,
    canWrite: access.canWrite,
    readProbe: access.readProbe,
    writeProbe: access.writeProbe,
    fix: access.fix,
  });
}
