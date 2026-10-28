import type { PoolConfig } from 'pg';

export function databaseConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  let connectionString = env.DATABASE_URL || 'postgresql://raven:raven@localhost:5432/ravenplanner';
  if (env.DYNO) {
    // pg lets URL SSL parameters replace the explicit ssl object below.
    const url = new URL(connectionString);
    for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
      url.searchParams.delete(key);
    }
    connectionString = url.toString();
  }

  return {
    connectionString,
    // Heroku Postgres certificates aren't signed by a CA trusted by Node.
    // Keep TLS encryption enabled using Heroku's Node connection configuration.
    ssl: env.DYNO ? { rejectUnauthorized: false } : undefined
  };
}
