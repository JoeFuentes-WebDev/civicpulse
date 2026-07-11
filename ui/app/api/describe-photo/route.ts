import { NextRequest, NextResponse } from 'next/server';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { CLAUDE_MODEL } from '../../../lib/agent';

export const maxDuration = 30;

const client = anthropic(CLAUDE_MODEL);

const DESCRIBE_PROMPT =
  'Describe this civic/street condition in one plain sentence, as if a resident were reporting it. Be factual, no speculation.';

/** Lightweight vision call — runs when a photo is attached, before the full agent run. */
export async function POST(req: NextRequest) {
  const { photoUrl } = await req.json();

  if (typeof photoUrl !== 'string' || !photoUrl) {
    return NextResponse.json({ error: 'photoUrl is required' }, { status: 400 });
  }

  const result = await generateText({
    model: client,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: DESCRIBE_PROMPT },
          { type: 'image', image: photoUrl },
        ],
      },
    ],
  });

  return NextResponse.json({ description: result.text.trim() });
}
