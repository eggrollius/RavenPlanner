import { availableParallelism } from 'node:os';
import path from 'node:path';

export interface AdvisorConfig { modelPath: string; threads: number; maxQueued: number; timeoutMs: number; cancelGraceMs: number }
function integer(value: string | undefined, fallback: number, min: number, max: number, name: string) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return result;
}
export function advisorConfig(env: NodeJS.ProcessEnv = process.env): AdvisorConfig {
  return {
    modelPath: path.resolve(env.RAVEN_ADVISOR_MODEL_PATH || '.local/models/smol.gguf'),
    threads: integer(env.RAVEN_ADVISOR_THREADS, Math.min(2, Math.max(1, availableParallelism() - 1)), 1, 16, 'RAVEN_ADVISOR_THREADS'),
    maxQueued: integer(env.RAVEN_ADVISOR_QUEUE_SIZE, 4, 0, 32, 'RAVEN_ADVISOR_QUEUE_SIZE'),
    timeoutMs: integer(env.RAVEN_ADVISOR_TIMEOUT_MS, 180000, 1000, 600000, 'RAVEN_ADVISOR_TIMEOUT_MS'),
    cancelGraceMs: 3000,
  };
}
