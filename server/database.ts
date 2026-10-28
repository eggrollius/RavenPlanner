import type { PoolConfig } from 'pg';

export function databaseConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  return {
    connectionString: env.DATABASE_URL || 'postgresql://raven:raven@localhost:5432/ravenplanner',
    // Heroku sets DYNO for existing apps as well as new apps and review apps.
    // Require TLS there without depending on app.json being applied at deploy time.
    ssl: env.DYNO ? true : undefined
  };
}
