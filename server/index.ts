import pg from 'pg';
import { createApp } from './app.js';
import { ensureSchema } from './schema.js';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://raven:raven@localhost:5432/ravenplanner';
const pool = new pg.Pool({ connectionString: databaseUrl });
await ensureSchema(pool);
const port = Number(process.env.PORT || 5000);
const server = createApp(pool).listen(port, '0.0.0.0', () => console.log(`Raven Planner listening on ${port}`));

async function shutdown() {
  server.close(async () => { await pool.end(); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
