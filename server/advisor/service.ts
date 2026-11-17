import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { AdvisorEvent, AdvisorStatus, TurnRequest } from '../../src/advisor/contracts.js';
import type { AdvisorConfig } from './config.js';

interface Job {
  request: TurnRequest; internalId: string; emit: (event: AdvisorEvent) => void;
  settled: boolean; timer: ReturnType<typeof setTimeout>;
}
export interface ServiceOptions { config: AdvisorConfig; apiOrigin: () => string; spawnWorker?: () => ChildProcess }

/** One resident model, one active turn, a small FIFO. No shared chat histories. */
export class AdvisorService {
  private child?: ChildProcess;
  private phase: AdvisorStatus['phase'] = 'idle';
  private queue: Job[] = [];
  private active?: Job;
  private cancelTimer?: ReturnType<typeof setTimeout>;
  private closing = false;

  constructor(private options: ServiceOptions) {}
  get workerPid() { return this.child?.pid; }
  get status(): AdvisorStatus {
    return { configured: existsSync(this.options.config.modelPath), phase: this.phase, active: this.active ? 1 : 0, queued: this.queue.length, maxQueued: this.options.config.maxQueued };
  }

  start() {
    if (this.child || this.closing || !this.status.configured) return;
    this.phase = 'loading';
    const source = import.meta.url.endsWith('.ts');
    const child = this.options.spawnWorker?.() || fork(new URL(source ? './worker.ts' : './worker.js', import.meta.url), [], {
      execArgv: source ? ['--import', 'tsx'] : [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    this.child = child;
    child.on('message', (message: Record<string, unknown>) => {
      if (this.child !== child || this.closing) return;
      if (message.type === 'ready') { this.phase = 'ready'; this.drain(); return; }
      if (message.type === 'unavailable') { this.failAll('The server’s advisor model could not be loaded. Please try again later.'); this.phase = 'unavailable'; child.kill(); return; }
      const job = this.active;
      if (!job || message.id !== job.internalId) return;
      const event = { ...message, id: job.request.id } as AdvisorEvent;
      if (['status', 'delta'].includes(event.type)) { if (!job.settled) job.emit(event); return; }
      if (!['done', 'cancelled', 'error'].includes(event.type)) return;
      if (!job.settled) { job.settled = true; job.emit(event); }
      clearTimeout(job.timer);
      clearTimeout(this.cancelTimer);
      this.cancelTimer = undefined;
      this.active = undefined;
      this.drain();
    });
    const failed = () => {
      if (this.child !== child) return;
      this.child = undefined;
      clearTimeout(this.cancelTimer);
      this.cancelTimer = undefined;
      if (this.closing) return;
      if (this.active?.settled) {
        clearTimeout(this.active.timer);
        this.active = undefined;
        this.phase = 'idle';
        if (this.queue.length) this.start();
        return;
      }
      this.phase = 'unavailable';
      this.failAll('The advisor process stopped. Your saved plan is unchanged; please retry.');
    };
    child.on('error', failed);
    child.on('exit', failed);
    child.send({ type: 'initialize', modelPath: this.options.config.modelPath, threads: this.options.config.threads, apiOrigin: this.options.apiOrigin() }, (error) => { if (error) { child.kill(); failed(); } });
  }

  submit(request: TurnRequest, emit: Job['emit']): () => void {
    const reject = (code: string, message: string) => emit({ type: 'error', id: request.id, code, message });
    if (this.closing) { reject('server_shutdown', 'The advisor is shutting down. Please retry shortly.'); return () => {}; }
    if (!this.status.configured) { reject('unavailable', 'The advisor model has not been installed on this server. Manual planning is available.'); return () => {}; }
    if (this.queue.length + (this.active ? 1 : 0) >= this.options.config.maxQueued + 1) {
      reject('busy', 'The advisor is busy and its waiting queue is full. Please try again shortly.'); return () => {};
    }
    const job: Job = { request, emit, internalId: randomUUID(), settled: false, timer: setTimeout(() => this.cancel(job, true), this.options.config.timeoutMs) };
    this.queue.push(job);
    this.positions();
    this.start();
    this.drain();
    return () => this.cancel(job, false);
  }

  private positions() {
    this.queue.forEach((job, index) => {
      const position = index + (this.active ? 1 : 0);
      job.emit({ type: 'status', id: job.request.id, position, message: position ? `Waiting for the advisor (${position} ahead)…` : 'Preparing the advisor…' });
    });
  }

  private drain() {
    if (this.active || this.phase !== 'ready' || !this.child || this.closing) return;
    const job = this.queue.shift();
    if (!job) return;
    this.active = job;
    job.emit({ type: 'status', id: job.request.id, message: 'Understanding your request…' });
    this.positions();
    this.child.send({ type: 'turn', request: { ...job.request, id: job.internalId } }, (error) => { if (error) this.child?.kill(); });
  }

  private cancel(job: Job, timeout: boolean) {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timer);
    job.emit(timeout ? { type: 'error', id: job.request.id, code: 'timeout', message: 'The advisor request timed out. Your saved plan is unchanged; please retry.' } : { type: 'cancelled', id: job.request.id });
    if (this.active !== job) { this.queue = this.queue.filter((entry) => entry !== job); this.positions(); return; }
    const child = this.child;
    child?.send({ type: 'cancel', id: job.internalId }, () => {});
    // Do not start another turn until the worker acknowledges cancellation.
    this.cancelTimer = setTimeout(() => child?.kill('SIGKILL'), this.options.config.cancelGraceMs);
  }

  private failAll(message: string) {
    for (const job of [...(this.active ? [this.active] : []), ...this.queue]) {
      clearTimeout(job.timer);
      if (!job.settled) { job.settled = true; job.emit({ type: 'error', id: job.request.id, code: 'worker_failed', message }); }
    }
    this.active = undefined;
    this.queue = [];
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    this.phase = 'closed';
    clearTimeout(this.cancelTimer);
    this.failAll('The advisor is shutting down. Your saved plan is unchanged.');
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, this.options.config.cancelGraceMs);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      if (child.exitCode !== null || child.signalCode !== null) { clearTimeout(timer); resolve(); }
      else child.kill('SIGTERM');
    });
    this.child = undefined;
  }
}
