import type { AdvisorEvent, AdvisorSession, AdvisorStatus, TurnResult } from './contracts';
import type { Catalog } from '../types';
export type { AdvisorModel, DecisionContext, Message } from './contracts';

export async function advisorStatus(signal?: AbortSignal): Promise<AdvisorStatus> {
  const response = await fetch('/api/advisor/status', { signal });
  if (!response.ok) throw new Error('Unable to connect to the advisor. Manual planning is available.');
  return response.json() as Promise<AdvisorStatus>;
}

export function streamTurn(catalog: Catalog, session: AdvisorSession, text: string, signal: AbortSignal, onStatus: (text: string) => void, onDelta: (text: string) => void): Promise<TurnResult> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const url = new URL('/api/advisor', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    const id = crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    let settled = false;
    // The server owns the deadline (configurable up to ten minutes). This is
    // only a backup for a connection that never closes or delivers its error.
    const timeout = setTimeout(() => finish(new Error('The advisor connection timed out. Your saved plan is unchanged.')), 11 * 60 * 1000);
    const connecting = setTimeout(() => finish(new Error('Unable to connect to the advisor. Please retry.')), 10000);
    const finish = (error?: Error, result?: TurnResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(connecting);
      signal.removeEventListener('abort', abort);
      socket.close();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'cancel', id }));
      finish(new DOMException('Cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    socket.onopen = () => {
      clearTimeout(connecting);
      if (settled || signal.aborted) { abort(); return; }
      // The structured plan carries durable constraints; only recent history
      // is needed for clarification. Keep even long Unicode chats under the
      // server payload limit while retaining full history in localStorage.
      socket.send(JSON.stringify({ type: 'turn', id, catalog, session: { ...session, messages: session.messages.slice(-4) }, text }));
    };
    socket.onmessage = (message) => {
      if (settled || signal.aborted) return;
      try {
        const event = JSON.parse(String(message.data)) as AdvisorEvent;
        if (event.id && event.id !== id) return;
        if (event.type === 'status') onStatus(event.message);
        else if (event.type === 'delta') onDelta(event.text);
        else if (event.type === 'done') finish(undefined, event.result);
        else if (event.type === 'error') finish(new Error(event.message));
        else if (event.type === 'cancelled') finish(new DOMException('Cancelled', 'AbortError'));
        else finish(new Error('The advisor sent an invalid response. Please retry.'));
      } catch { finish(new Error('The advisor connection returned invalid data. Please retry.')); }
    };
    socket.onerror = () => finish(new Error('The advisor connection failed. Your saved plan is unchanged; please retry.'));
    socket.onclose = () => finish(new Error('The advisor disconnected before completing your request. Your saved plan is unchanged.'));
  });
}
