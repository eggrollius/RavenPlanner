import type { Express } from 'express';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { AdvisorEvent } from '../../src/advisor/contracts.js';
import { AdvisorService } from './service.js';
import { validateTurn } from './validation.js';

export function attachAdvisor(server: Server, app: Express, advisor: AdvisorService) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });
  const alive = new Set<WebSocket>();
  app.get('/api/advisor/status', (_req, res) => res.json(advisor.status));
  server.on('upgrade', (request, socket, head) => {
    let allowed = false;
    try { allowed = new URL(request.url || '', 'http://localhost').pathname === '/api/advisor' && new URL(request.headers.origin || '').host === request.headers.host; } catch { /* Invalid or missing Origin. */ }
    if (!allowed || sockets.clients.size >= 32) {
      socket.end(`HTTP/1.1 ${allowed ? '503 Service Unavailable' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`);
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => sockets.emit('connection', client));
  });
  sockets.on('connection', (socket) => {
    let cancel: (() => void) | undefined;
    let requestId: string | undefined;
    let terminal = false;
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
    const send = (event: AdvisorEvent) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 1024 * 1024) { socket.terminate(); return; }
      if (['done', 'error', 'cancelled'].includes(event.type)) terminal = true;
      socket.send(JSON.stringify(event), (error) => { if (error) socket.terminate(); });
    };
    socket.on('message', (data, binary) => {
      try {
        if (binary) throw new Error('Only JSON text messages are supported.');
        const value: unknown = JSON.parse(data.toString());
        if (value && typeof value === 'object' && 'type' in value && value.type === 'cancel') {
          if ('id' in value && value.id === requestId) cancel?.();
          return;
        }
        if (requestId) throw new Error('Only one advisor turn is allowed per connection.');
        const request = validateTurn(value);
        requestId = request.id;
        cancel = advisor.submit(request, send);
      } catch (error) {
        send({ type: 'error', id: requestId || '', code: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid advisor request.' });
        // A malformed extra message must not leave an existing job running.
        cancel?.();
        socket.close(1008, 'Invalid request');
      }
    });
    const closed = () => { alive.delete(socket); if (!terminal) cancel?.(); };
    socket.on('close', closed);
    socket.on('error', () => socket.terminate());
  });
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!alive.delete(socket)) socket.terminate();
      else socket.ping();
    }
  }, 15000);
  heartbeat.unref();
  return {
    close() { clearInterval(heartbeat); for (const socket of sockets.clients) socket.terminate(); sockets.close(); },
  };
}
