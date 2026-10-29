import pg from 'pg';
import { databaseConfig } from './database.js';
import { ensureSchema } from './schema.js';

const pool = new pg.Pool(databaseConfig());
try {
  await ensureSchema(pool);
  console.log('Raven Planner database migrations complete.');
} finally {
  await pool.end();
}
