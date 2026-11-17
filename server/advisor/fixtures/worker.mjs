/* global process, clearTimeout, setTimeout */
// Real child process used by service tests. Never imported by production.
let pending;
const send = (message) => process.send?.(message);
process.on('message', (message) => {
  if (message.type === 'initialize') return send({ type: 'ready' });
  if (message.type === 'cancel') {
    if (pending?.id !== message.id) return;
    clearTimeout(pending.timer);
    pending = undefined;
    return send({ type: 'cancelled', id: message.id });
  }
  if (message.type !== 'turn') return;
  const request = message.request;
  send({ type: 'delta', id: request.id, text: 'Your ' });
  if (request.text === 'crash') return process.exit(9);
  if (request.text === 'hang') { while (true) Math.sqrt(Math.random()); }
  const finish = () => {
    send({ type: 'delta', id: request.id, text: 'reply.' });
    send({ type: 'done', id: request.id, result: { plan: request.session.plan, reply: 'Your reply.', current: false, trace: [] } });
    pending = undefined;
  };
  if (request.text === 'cpu') {
    const until = Date.now() + 1500;
    while (Date.now() < until) Math.sqrt(Math.random());
    return finish();
  }
  pending = { id: request.id, timer: request.text === 'hold' ? undefined : setTimeout(finish, 20) };
});
