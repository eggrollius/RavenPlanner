import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newDb } from 'pg-mem';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { ensureSchema } from './schema.js';
import { readFeatures } from './features.js';
import { configureAdvisor } from './advisor/runtime.js';
import { emptyPlan } from '../src/advisor/schema.js';

let directory: string;
let server: ReturnType<typeof createServer>;
let advisor: ReturnType<typeof configureAdvisor>;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'raven-features-')); });
afterEach(async () => {
  await advisor?.close();
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  advisor = undefined;
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function boot() {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  await ensureSchema(pool);
  const features = readFeatures();
  const app = createApp(pool, 'FALL', 2026, features);
  server = createServer(app);
  advisor = configureAdvisor(server, app, features);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  advisor?.start();
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

it.each([undefined, 'false', 'TRUE', '1'])('keeps manual APIs available and inference disabled for flag %s', async (flag) => {
  vi.stubEnv('RAVEN_ADVISOR_ENABLED', flag);
  vi.stubEnv('HEROKU_PR_NUMBER', undefined);
  // Even provisioned weights and invalid AI settings must not affect prod boot.
  const modelPath = path.join(directory, 'model.gguf');
  await writeFile(modelPath, 'present');
  vi.stubEnv('RAVEN_ADVISOR_MODEL_PATH', modelPath);
  vi.stubEnv('RAVEN_ADVISOR_THREADS', 'invalid');
  const origin = await boot();
  expect(advisor).toBeUndefined();
  expect(server.listenerCount('upgrade')).toBe(0);
  expect(await fetch(`${origin}/api/catalog`).then((res) => res.json())).toMatchObject({ features: { aiAdvisor: false } });
  expect((await fetch(`${origin}/api/advisor/status`)).status).toBe(404);
  expect((await fetch(`${origin}/api/advisor`)).status).toBe(404);
  expect(await fetch(`${origin}/api/health`).then((res) => res.json())).toEqual({ status: 'ok' });
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/advisor', { origin });
  await expect(new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); })).rejects.toThrow('404');
});

it.each(['explicit flag', 'existing review app'])('exposes AI discovery and WebSocket for %s', async (environment) => {
  vi.stubEnv('RAVEN_ADVISOR_ENABLED', environment === 'explicit flag' ? 'true' : undefined);
  vi.stubEnv('HEROKU_PR_NUMBER', environment === 'existing review app' ? '18' : undefined);
  vi.stubEnv('RAVEN_ADVISOR_MODEL_PATH', path.join(directory, 'not-installed.gguf'));
  const origin = await boot();
  expect(await fetch(`${origin}/api/catalog`).then((res) => res.json())).toMatchObject({ features: { aiAdvisor: true } });
  expect(await fetch(`${origin}/api/advisor/status`).then((res) => res.json())).toMatchObject({ configured: false });
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/advisor', { origin });
  try {
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const response = new Promise((resolve) => socket.once('message', (data) => resolve(JSON.parse(data.toString()))));
    socket.send(JSON.stringify({ type: 'turn', id: 'flag-enabled', catalog: { term: 'FALL', year: 2026 }, session: { plan: emptyPlan(), messages: [], previousCRNs: [] }, text: 'Plan my schedule.' }));
    await expect(response).resolves.toMatchObject({ type: 'error', code: 'unavailable' });
  } finally { socket.terminate(); }
});

it('honors an explicit preview opt-out and does not infer preview from arbitrary names', () => {
  for (const flag of ['false', 'TRUE', '1']) expect(readFeatures({ RAVEN_ADVISOR_ENABLED: flag, HEROKU_PR_NUMBER: '18' }).aiAdvisor).toBe(false);
  expect(readFeatures({ HEROKU_APP_NAME: 'raven-planner-preview', DYNO: 'web.1' }).aiAdvisor).toBe(false);
  expect(readFeatures({ HEROKU_PR_NUMBER: 'not-a-pr' }).aiAdvisor).toBe(false);
});
it('enables and provisions Heroku review apps while production defaults off', async () => {
  const manifest = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'));
  const production = Object.fromEntries(Object.entries(manifest.env).map(([key, entry]) => [key, (entry as { value: string }).value]));
  const review = manifest.environments.review.env;
  expect(readFeatures(production).aiAdvisor).toBe(false);
  expect(production.RAVEN_ADVISOR_DOWNLOAD_ON_BUILD).toBe('false');
  expect(readFeatures(review).aiAdvisor).toBe(true);
  expect(review.RAVEN_ADVISOR_DOWNLOAD_ON_BUILD).toBe('true');
  // Heroku replaces the entire env block; preview must retain base settings.
  expect(Object.keys(review).sort()).toEqual(Object.keys(production).sort());
  expect(review.NODE_LLAMA_CPP_GPU).toBe('false');
  expect(review.NODE_LLAMA_CPP_SKIP_DOWNLOAD).toBe('true');
});
