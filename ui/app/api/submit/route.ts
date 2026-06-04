import { NextRequest, NextResponse } from 'next/server';
import { getSubmitContextFromRun, submitTo311, Submit311Error } from '../../../lib/submit311';
import { getRun, setRun } from '../store';

export async function POST(req: NextRequest) {
  const { id } = await req.json();

  const run = await getRun(id);

  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  if (run.serviceRequestId) {
    return NextResponse.json({
      serviceRequestId: run.serviceRequestId,
      mock: run.submission === 'mock',
    });
  }

  try {
    const { payload, city } = getSubmitContextFromRun(run);
    const result = await submitTo311(payload, city);

    const updated = {
      ...run,
      serviceRequestId: result.serviceRequestId,
      submission: result.mock ? ('mock' as const) : ('user' as const),
      status: 'complete' as const,
    };

    await setRun(updated);

    return NextResponse.json({
      serviceRequestId: result.serviceRequestId,
      mock: result.mock,
    });
  } catch (err) {
    if (err instanceof Submit311Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
