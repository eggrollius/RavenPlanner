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
    expect(client.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('handles existing Heroku apps with PGSSLMODE still set to verify-full', () => {
    vi.stubEnv('PGSSLMODE', 'verify-full');
    const client = new pg.Client(databaseConfig({ DYNO: 'web.1' }));

    expect(client.ssl).toEqual({ rejectUnauthorized: false });
  });

  it.each(['verify-full', 'disable'])('prevents URL sslmode=%s from replacing Heroku TLS settings', (sslmode) => {
    const client = new pg.Client(databaseConfig({
      DYNO: 'web.1',
      DATABASE_URL: `postgresql://raven:password@database.example:5432/planner?sslmode=${sslmode}&application_name=raven`
    }));

    expect(client.ssl).toEqual({ rejectUnauthorized: false });
    expect(client.connectionParameters.application_name).toBe('raven');
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
