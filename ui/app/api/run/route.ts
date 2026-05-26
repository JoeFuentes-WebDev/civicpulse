import { NextRequest, NextResponse } from 'next/server';
import { AgentRun, CivicReport } from '@shared/types';
import { setRun } from '../store';
import { randomUUID } from 'crypto';
import { runCivicAgent } from '../../../lib/agent';

export async function POST(req: NextRequest) {
  const input: CivicReport = await req.json();

  const run: AgentRun = {
    id: randomUUID(),
    input,
    steps: [],
    status: 'running',
  };

  setRun(run);

  // Run agent in background
  runCivicAgent(
    { text: input.text, lat: input.lat, lng: input.lng }
  ).then(async (result) => {
    const updated: AgentRun = {
      ...run,
      status: 'complete',
      steps: result.toolResults.map((tr, i) => ({
        id: `step-${i}`,
        name: tr.tool,
        status: 'complete' as const,
        output: tr.result as Record<string, unknown>,
        timestamp: new Date(),
      })),
      draft: result.text,
    };
    setRun(updated);
  }).catch(err => {
    const failed: AgentRun = {
      ...run,
      status: 'error',
      steps: [{
        id: 'error',
        name: 'Agent Error',
        status: 'error',
        error: err.message,
        timestamp: new Date(),
      }],
    };
    setRun(failed);
  });

  return NextResponse.json({ id: run.id });
}