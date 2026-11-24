import { runTurn } from '../../src/advisor/agent.js';
import type { TurnRequest } from '../../src/advisor/contracts.js';
import { NativeModel } from './native-model.js';
import { serverTools } from './tools.js';

let model: NativeModel | undefined;
let apiOrigin = '';
let current: { id: string; controller: AbortController } | undefined;
const send = (message: unknown) => { if (process.connected) process.send?.(message); };
process.on('message', async (message: { type: string; modelPath?: string; threads?: number; apiOrigin?: string; request?: TurnRequest; id?: string }) => {
  if (message.type === 'initialize') {
    try {
      apiOrigin = message.apiOrigin!;
      model = await NativeModel.load(message.modelPath!, message.threads!);
      send({ type: 'ready' });
    } catch (error) {
      console.error('Advisor model initialization failed:', error instanceof Error ? error.message : String(error));
      send({ type: 'unavailable' });
    }
    return;
  }
  if (message.type === 'cancel' && current && current.id === message.id) { current.controller.abort(); return; }
  if (message.type !== 'turn' || !message.request || !model || current) return;
  const request = message.request;
  const controller = new AbortController();
  current = { id: request.id, controller };
  try {
    const result = await runTurn(request.session, request.text, model, serverTools(request.catalog, apiOrigin), controller.signal, (text) => send({ type: 'status', id: request.id, message: text }));
    send({ type: 'status', id: request.id, message: 'Writing your reply…' });
    result.reply = await model.reply(result.reply, controller.signal, (text) => send({ type: 'delta', id: request.id, text }));
    send({ type: 'done', id: request.id, result });
  } catch (error) {
    if (controller.signal.aborted) send({ type: 'cancelled', id: request.id });
    else send({ type: 'error', id: request.id, code: 'inference_failed', message: error instanceof Error ? error.message : 'The advisor could not complete this request.' });
  } finally { current = undefined; }
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  current?.controller.abort();
  await model?.close().catch(() => {});
  process.exit(0);
}
process.on('disconnect', close);
process.on('SIGTERM', close);
