import { Redis } from '@upstash/redis';
import { AgentRun } from '@shared/types';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});
console.log('UPSTASH_URL:', process.env.UPSTASH_REDIS_REST_URL?.slice(0, 30));
const TTL = 60 * 60; // 1 hour

export async function getRun(id: string): Promise<AgentRun | null> {
  return await redis.get<AgentRun>(`run:${id}`);
}

export async function setRun(run: AgentRun): Promise<void> {
  await redis.set(`run:${run.id}`, run, { ex: TTL });
}