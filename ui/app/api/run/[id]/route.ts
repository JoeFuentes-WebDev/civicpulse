import { NextRequest, NextResponse } from 'next/server';
import { AgentRun } from '@shared/types';
import { finishAgentRun } from '../../../../lib/finishAgentRun';
import { getRun, setRun } from '../../store';

export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await getRun(id);

  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  return NextResponse.json(run);
}

/** Re-run the agent after the user edits their description. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await getRun(id);

  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  if (run.serviceRequestId) {
    return NextResponse.json(
      { error: 'Report already submitted' },
      { status: 400 }
    );
  }

  const body = await req.json();
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!text) {
    return NextResponse.json(
      { error: 'Description is required' },
      { status: 400 }
    );
  }

  const running: AgentRun = {
    ...run,
    status: 'running',
    steps: [],
    draft: undefined,
    needsReview: undefined,
    serviceRequestId: undefined,
    submission: undefined,
    locationGeocodeFailed: undefined,
    locationMention: undefined,
    locationSource: undefined,
  };
  await setRun(running);

  try {
    const updated = await finishAgentRun(run, {
      text,
      lat: run.input.lat,
      lng: run.input.lng,
      photoUrl: run.input.photoUrl,
    });
    await setRun(updated);
    return NextResponse.json(updated);
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}