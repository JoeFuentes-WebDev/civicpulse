import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getRun } from '../../store';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  const storePath = join(process.cwd(), '.store.json');

  if (!existsSync(storePath)) {
    return NextResponse.json({ error: 'No store' }, { status: 404 });
  }

  // const data = JSON.parse(readFileSync(storePath, 'utf-8'));
  const run = await getRun(id);
  
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  return NextResponse.json(run);
}