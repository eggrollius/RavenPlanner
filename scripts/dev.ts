import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import concurrently from 'concurrently';
import pg from 'pg';
import { loadEnv } from 'vite';
import { readCatalog } from '../server/catalog.js';
import { seedDevelopmentCatalog } from './dev-catalog.js';
import { startLocalDatabase } from './local-database.js';

const { values } = parseArgs({ options: { reset: { type: 'boolean' }, seed: { type: 'boolean' }, ephemeral: { type: 'boolean' } } });
const env = loadEnv('development', process.cwd(), '');
const catalog = readCatalog(env);
const dataDir = path.resolve('.local/postgres');
const lockPath = path.resolve('.local/postgres.lock');

async function lockDatabase() {
  await mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(lockPath, 'wx');
      await file.writeFile(String(process.pid));
      await file.close();
      return () => unlink(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number(await readFile(lockPath, 'utf8'));
      if (Number.isSafeInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); }
        catch (probeError) {
          if ((probeError as NodeJS.ErrnoException).code === 'ESRCH') {
            await unlink(lockPath);
            continue;
          }
        }
      }
      throw new Error('The local database is already in use. Stop npm run dev before seeding or resetting it.', { cause: error });
    }
  }
  throw new Error('Could not lock the local database.');
}

async function checkPort(value: string, name: string) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be a port between 1 and 65535.`);
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is unavailable. Stop the other process or set ${name} to a free port.`)));
    server.listen(port, '0.0.0.0', () => server.close(() => resolve()));
  });
}

async function main() {
  const onlySeed = values.reset || values.seed;
  const port = env.PORT || '5000';
  const vitePort = env.VITE_PORT || '5173';
  if (!onlySeed) {
    if (Number(port) === Number(vitePort)) throw new Error('PORT and VITE_PORT must be different.');
    await checkPort(port, 'PORT');
    await checkPort(vitePort, 'VITE_PORT');
  }
  const unlock = values.ephemeral ? undefined : await lockDatabase();
  let database: Awaited<ReturnType<typeof startLocalDatabase>> | undefined;
  let stopping = false;
  // concurrently forwards signals to the child process trees once they start.
  const stop = () => {
    stopping = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    database = await startLocalDatabase(values.ephemeral ? undefined : dataDir);
    const pool = new pg.Pool({ connectionString: database.connectionString, max: 1 });
    try {
      let count = 0;
      for (const term of [catalog.term, ...(['WINTER', 'SUMMER', 'FALL'] as const).filter((term) => term !== catalog.term)]) {
        count += await seedDevelopmentCatalog(pool, { term, year: catalog.year }, values.reset && term === catalog.term);
      }
      console.log(count ? `Loaded ${count} synthetic sections across three demo catalogs for ${catalog.year}.` : `Keeping existing local catalogs for ${catalog.year}.`);
    } finally {
      await pool.end();
    }
    if (onlySeed || stopping) return;
    console.log(`Local PostgreSQL: ${values.ephemeral ? 'in memory' : dataDir}\nOpen http://localhost:${vitePort}. Try COMP 1405, MATH 1007, and PSYC 1001.`);
    const childEnv = {
      ...process.env,
      DATABASE_URL: database.connectionString,
      NODE_ENV: 'development',
      DYNO: '',
      ACTIVE_TERM: catalog.term,
      ACTIVE_YEAR: String(catalog.year),
      PORT: port,
      VITE_PORT: vitePort,
    };
    const children = concurrently([
      { name: 'api', command: 'tsx watch server/index.ts', env: childEnv },
      { name: 'web', command: 'vite --host 0.0.0.0', env: childEnv },
    ], { killOthersOn: ['success', 'failure'], successCondition: 'first', killTimeout: 5000 });
    try { await children.result; }
    catch (error) {
      if (!stopping) throw new Error('The development stack stopped unexpectedly. See the service error above.', { cause: error });
    }
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await database?.close();
    await unlock?.();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
