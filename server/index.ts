import pg from 'pg';
import { createApp } from './app.js';
import { databaseConfig } from './database.js';
import { ensureSchema } from './schema.js';
import { createServer } from 'node:http';
import { readFeatures } from './features.js';
import { configureAdvisor } from './advisor/runtime.js';

const pool = new pg.Pool(databaseConfig());
await ensureSchema(pool);
const port = Number(process.env.PORT || 5000);
const features = readFeatures();
const app = createApp(pool, undefined, undefined, features);
const server = createServer(app);
const advisor = configureAdvisor(server, app, features);
server.listen(port, '0.0.0.0', () => {
  console.log(`Raven Planner listening on ${port}`);
  advisor?.start();
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await advisor?.close();
  server.close(async () => { await pool.end(); process.exit(0); });
  server.closeIdleConnections();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
