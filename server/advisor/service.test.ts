import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { AdvisorService } from './service.js';
import type { AdvisorConfig } from './config.js';
import { attachAdvisor } from './socket.js';
import { validateTurn } from './validation.js';
import { emptyPlan } from '../../src/advisor/schema.js';
import type { AdvisorEvent, TurnRequest } from '../../src/advisor/contracts.js';

const request = (id: string, text = 'normal'): TurnRequest => ({ type: 'turn', id, text, catalog: { term: 'FALL', year: 2026 }, session: { plan: emptyPlan(), messages: [], previousCRNs: [] } });
const until = async (check: () => boolean) => { for (let tries = 0; tries < 200; tries++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('Timed out waiting for advisor test event'); };

describe('isolated inference service and WebSocket transport', () => {
  let directory: string;
  let advisor: AdvisorService;
  let config: AdvisorConfig;
  const servers: ReturnType<typeof createServer>[] = [];
  const transports: ReturnType<typeof attachAdvisor>[] = [];
  const clients: WebSocket[] = [];
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'raven-advisor-'));
    await writeFile(path.join(directory, 'model.gguf'), 'fixture');
    config = { modelPath: path.join(directory, 'model.gguf'), threads: 1, maxQueued: 2, timeoutMs: 5000, cancelGraceMs: 100 };
    advisor = new AdvisorService({
      config,
      apiOrigin: () => 'http://127.0.0.1:1',
      spawnWorker: () => fork(new URL('./fixtures/worker.mjs', import.meta.url), [], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }),
    });
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) client.terminate();
    for (const transport of transports.splice(0)) transport.close();
    await advisor.close();
    for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const submit = (id: string, text = 'normal') => {
    const events: AdvisorEvent[] = [];
    const cancel = advisor.submit(request(id, text), (event) => events.push(event));
    return { events, cancel };
  };
  const serve = async () => {
    const app = express();
    app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
    const server = createServer(app);
    transports.push(attachAdvisor(server, app, advisor)); servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  };

  it('bounds admission, serves FIFO, updates positions, and cancels waiting jobs', async () => {
    const first = submit('first', 'hold');
    await until(() => first.events.some((event) => event.type === 'delta'));
    const pid = advisor.workerPid;
    const second = submit('second'); const third = submit('third'); const overflow = submit('overflow');
    expect(overflow.events).toContainEqual(expect.objectContaining({ type: 'error', code: 'busy' }));
    expect(advisor.status).toMatchObject({ active: 1, queued: 2 });
    expect(third.events).toContainEqual(expect.objectContaining({ type: 'status', position: 2 }));
    second.cancel();
    expect(third.events).toContainEqual(expect.objectContaining({ type: 'status', position: 1 }));
    first.cancel();
    await until(() => third.events.some((event) => event.type === 'done'));
    expect(advisor.workerPid).toBe(pid);
    expect(first.events.some((event) => event.type === 'done')).toBe(false);
    expect(second.events.some((event) => event.type === 'delta')).toBe(false);
  });

  it('keeps HTTP requests responsive while the inference child runs CPU work', async () => {
    const origin = await serve();
    const job = submit('cpu', 'cpu');
    await until(() => job.events.some((event) => event.type === 'delta'));
    expect(advisor.workerPid).not.toBe(process.pid);
    const began = Date.now();
    const responses = await Promise.all(Array.from({ length: 10 }, () => fetch(`${origin}/api/health`).then((response) => response.json())));
    expect(Date.now() - began).toBeLessThan(1000);
    expect(responses).toEqual(Array.from({ length: 10 }, () => ({ status: 'ok' })));
    expect(advisor.status.active).toBe(1);
    await until(() => job.events.some((event) => event.type === 'done'));
  });

  it('restarts a hung cancelled worker before processing the next student', async () => {
    const hung = submit('hung', 'hang');
    await until(() => hung.events.some((event) => event.type === 'delta'));
    const original = advisor.workerPid;
    const next = submit('next'); hung.cancel();
    await until(() => next.events.some((event) => event.type === 'done'));
    expect(advisor.workerPid).not.toBe(original);
    expect(hung.events.filter((event) => event.type === 'cancelled')).toHaveLength(1);
    expect(hung.events.some((event) => event.type === 'done')).toBe(false);
  });

  it('fails outstanding jobs on a crash and recovers on the next request', async () => {
    const crashed = submit('crashed', 'crash'); const waiting = submit('waiting');
    await until(() => waiting.events.some((event) => event.type === 'error'));
    expect(crashed.events).toContainEqual(expect.objectContaining({ type: 'error', code: 'worker_failed' }));
    const recovery = submit('recovery');
    await until(() => recovery.events.some((event) => event.type === 'done'));
  });

  it('times out waiting and active requests, then accepts work after recovery', async () => {
    config.timeoutMs = 500; config.cancelGraceMs = 600;
    const active = submit('deadline', 'hang');
    await until(() => active.events.some((event) => event.type === 'delta'));
    const waiting = submit('waiting-deadline');
    await until(() => waiting.events.some((event) => event.type === 'error'));
    expect(active.events).toContainEqual(expect.objectContaining({ type: 'error', code: 'timeout' }));
    expect(waiting.events).toContainEqual(expect.objectContaining({ type: 'error', code: 'timeout' }));
    expect(waiting.events.some((event) => event.type === 'delta')).toBe(false);
    await until(() => advisor.status.active === 0);
    config.timeoutMs = 3000;
    const recovery = submit('after-deadline');
    await until(() => recovery.events.some((event) => event.type === 'done'));
  });

  it('leaves normal HTTP available when no server model is installed', async () => {
    await rm(config.modelPath);
    const origin = await serve();
    expect(await fetch(`${origin}/api/health`).then((response) => response.json())).toEqual({ status: 'ok' });
    expect(await fetch(`${origin}/api/advisor/status`).then((response) => response.json())).toMatchObject({ configured: false });
    expect(submit('missing-model').events).toContainEqual(expect.objectContaining({ type: 'error', code: 'unavailable' }));
    expect(advisor.workerPid).toBeUndefined();
  });

  it('cancels an active job when its socket closes, and rejects cross-origin upgrades', async () => {
    const origin = await serve();
    const client = new WebSocket(origin.replace('http:', 'ws:') + '/api/advisor', { origin }); clients.push(client);
    await new Promise<void>((resolve) => client.once('open', resolve));
    const events: AdvisorEvent[] = [];
    client.on('message', (data) => events.push(JSON.parse(data.toString())));
    client.send(JSON.stringify(request('socket', 'hold')));
    await until(() => events.some((event) => event.type === 'delta'));
    client.close();
    await until(() => advisor.status.active === 0);
    const foreign = new WebSocket(origin.replace('http:', 'ws:') + '/api/advisor', { origin: 'https://another-site.example' }); clients.push(foreign);
    await expect(new Promise((resolve, reject) => { foreign.once('open', resolve); foreign.once('error', reject); })).rejects.toThrow('403');
  });

  it('validates untrusted socket inputs before admitting any inference', async () => {
    const origin = await serve();
    const client = new WebSocket(origin.replace('http:', 'ws:') + '/api/advisor', { origin }); clients.push(client);
    await new Promise<void>((resolve) => client.once('open', resolve));
    const message = new Promise<AdvisorEvent>((resolve) => client.once('message', (data) => resolve(JSON.parse(data.toString()))));
    client.send(JSON.stringify({ ...request('bad'), text: 'x'.repeat(1501) }));
    expect(await message).toMatchObject({ type: 'error', code: 'invalid_request' });
    expect(advisor.workerPid).toBeUndefined();
    expect(() => validateTurn({ ...request('bad-state'), session: { ...request('x').session, plan: { ...emptyPlan(), daysOff: ['Friday'] } } })).toThrow();
  });

  it('shuts down an active job and waiting jobs without leaking their timers', async () => {
    const active = submit('active', 'hold'); await until(() => advisor.status.active === 1);
    const queued = submit('queued'); await advisor.close();
    expect(active.events).toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(queued.events).toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(advisor.status).toMatchObject({ phase: 'closed', active: 0, queued: 0 });
  });
});
