import { NextResponse } from 'next/server';
import { getRun } from '../../store';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await getRun(id);

  if (!run) {
    return NextResponse.json(
      { error: 'Run not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(run);
}