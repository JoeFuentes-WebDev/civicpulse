import { NextRequest, NextResponse } from 'next/server';
import { getRun, setRun } from '../store';

export async function POST(req: NextRequest) {
  const { id } = await req.json();

  const run = getRun(id);

  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  // Mock 311 submission for POC
  // Phase 2: call real Open311 API here
  const serviceRequestId = `SF311-${Date.now()}`;

  const updated = {
    ...run,
    serviceRequestId,
    status: 'complete' as const,
  };

  setRun(updated);

  return NextResponse.json({ serviceRequestId });
}