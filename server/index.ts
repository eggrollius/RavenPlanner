import pg from 'pg';
import { createApp } from './app.js';
import { databaseConfig } from './database.js';
import { ensureSchema } from './schema.js';
import { createServer } from 'node:http';
import { advisorConfig } from './advisor/config.js';
import { AdvisorService } from './advisor/service.js';
import { attachAdvisor } from './advisor/socket.js';

const pool = new pg.Pool(databaseConfig());
await ensureSchema(pool);
const port = Number(process.env.PORT || 5000);
const app = createApp(pool);
const server = createServer(app);
const advisor = new AdvisorService({ config: advisorConfig(), apiOrigin: () => `http://127.0.0.1:${(server.address() as { port: number }).port}` });
const transport = attachAdvisor(server, app, advisor);
server.listen(port, '0.0.0.0', () => {
  console.log(`Raven Planner listening on ${port}`);
  advisor.start();
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  transport.close();
  await advisor.close();
  server.close(async () => { await pool.end(); process.exit(0); });
  server.closeIdleConnections();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
