// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSecureContext, TLSSocket } from 'node:tls';
import pg from 'pg';
import { expect, it } from 'vitest';
import { databaseConfig } from './database.js';

it('connects over encrypted PostgreSQL transport with an untrusted certificate', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'raven-postgres-tls-'));
  const sockets = new Set<Socket>();
  const clients: pg.Client[] = [];
  let encryptedStartup = false;
  const server = createServer();

  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'),
      '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    const secureContext = createSecureContext({
      key: readFileSync(join(directory, 'key.pem')),
      cert: readFileSync(join(directory, 'cert.pem'))
    });

    // Minimal PostgreSQL transport: accept SSLRequest, then answer StartupMessage.
    server.on('connection', socket => {
      sockets.add(socket);
      socket.once('data', request => {
        expect(request).toEqual(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]));
        socket.write('S');
        const tlsSocket = new TLSSocket(socket, { isServer: true, secureContext });
        sockets.add(tlsSocket);
        tlsSocket.on('error', () => { /* The verified client rejects this certificate. */ });
        tlsSocket.once('data', () => {
          encryptedStartup = tlsSocket.encrypted;
          // AuthenticationOk followed by ReadyForQuery (idle).
          tlsSocket.write(Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 0, 90, 0, 0, 0, 5, 73]));
        });
        tlsSocket.on('end', () => tlsSocket.end());
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const config = databaseConfig({
      DYNO: 'web.1',
      DATABASE_URL: `postgresql://raven:password@127.0.0.1:${port}/planner?sslmode=verify-full`
    });

    const verified = new pg.Client({ ...config, ssl: true, connectionTimeoutMillis: 2000 });
    clients.push(verified);
    await expect(verified.connect()).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });

    const heroku = new pg.Client({ ...config, connectionTimeoutMillis: 2000 });
    clients.push(heroku);
    await heroku.connect();
    expect(encryptedStartup).toBe(true);
  } finally {
    for (const socket of sockets) socket.destroy();
    await Promise.allSettled(clients.map(client => client.end()));
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
