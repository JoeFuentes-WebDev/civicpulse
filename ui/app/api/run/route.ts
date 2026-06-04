import { NextRequest, NextResponse } from 'next/server';
import { AgentRun, CivicReport } from '@shared/types';
import { setRun } from '../store';
import { randomUUID } from 'crypto';
import { finishAgentRun } from '../../../lib/finishAgentRun';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const input: CivicReport = await req.json();

  const run: AgentRun = {
    id: randomUUID(),
    input,
    steps: [],
    status: 'running',
  };

  await setRun(run);

  try {
    const updated = await finishAgentRun(run, {
      text: input.text,
      lat: input.lat,
      lng: input.lng,
      photoUrl: input.photoUrl,
    });
    await setRun(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const failed: AgentRun = {
      ...run,
      status: 'error',
      steps: [
        {
          id: 'error',
          name: 'Agent Error',
          status: 'error',
          error: message,
          timestamp: new Date(),
        },
      ],
    };
    await setRun(failed);
  }

  return NextResponse.json({ id: run.id });
}
