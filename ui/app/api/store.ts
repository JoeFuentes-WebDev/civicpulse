import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

type AgentRun = any;

const STORE_PATH = join(process.cwd(), '.store.json');
console.log('store.ts loaded, STORE_PATH:', STORE_PATH);

function readStore(): Map<string, AgentRun> {
  console.log('readStore called, path:', STORE_PATH);
  if (!existsSync(STORE_PATH)) return new Map();
  const data = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
  return new Map(Object.entries(data));
}

function writeStore(runs: Map<string, AgentRun>) {
  console.log('writeStore called, path:', STORE_PATH);
  const data = Object.fromEntries(runs);
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

export function getRun(id: string): AgentRun | undefined {
  return readStore().get(id);
}

export function setRun(run: AgentRun): void {
  const store = readStore();
  store.set(run.id, run);
  writeStore(store);
}