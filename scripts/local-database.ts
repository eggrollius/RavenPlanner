import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { setImmediate } from 'node:timers/promises';

export async function startLocalDatabase(dataDir?: string) {
  const db = await PGlite.create(dataDir);
  const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 16 });
  try {
    await server.start();
  } catch (error) {
    await db.close();
    throw error;
  }
  return {
    // This URL is generated here and always points to this process's database.
    connectionString: `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`,
    async close() {
      await server.stop();
      // The socket adapter schedules close callbacks with setImmediate. Drain
      // them while PostgreSQL is alive so they can finish transaction cleanup.
      await setImmediate();
      await db.close();
    },
  };
}
