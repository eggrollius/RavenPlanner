// @vitest-environment node
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { databaseConfig } from './database.js';

afterEach(() => vi.unstubAllEnvs());

describe('database connection configuration', () => {
  it('requires TLS on an existing Heroku app without PGSSLMODE', () => {
    vi.stubEnv('PGSSLMODE', undefined);
    const connectionString = 'postgresql://raven:password@database.example:5432/planner';
    const client = new pg.Client(databaseConfig({ DATABASE_URL: connectionString, DYNO: 'web.1' }));

    expect(client.connectionParameters.database).toBe('planner');
    expect(client.ssl).toBe(true);
  });

  it('retains TLS certificate verification for Heroku connections', () => {
    vi.stubEnv('PGSSLMODE', 'verify-full');
    const client = new pg.Client(databaseConfig({ DYNO: 'web.1' }));

    expect(client.ssl).toBe(true);
  });

  it('allows the local development database to run without TLS', () => {
    vi.stubEnv('PGSSLMODE', undefined);
    const client = new pg.Client(databaseConfig({}));

    expect(client.connectionParameters.host).toBe('localhost');
    expect(client.connectionParameters.database).toBe('ravenplanner');
    expect(client.ssl).toBe(false);
  });

  it('allows production Docker connections to use their supplied database URL', () => {
    vi.stubEnv('PGSSLMODE', undefined);
    const client = new pg.Client(databaseConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://raven:password@db:5432/ravenplanner'
    }));

    expect(client.connectionParameters.host).toBe('db');
    expect(client.ssl).toBe(false);
  });
});
