import { once } from 'node:events';
import type { Server } from 'node:http';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { ensureSchema } from '../server/schema.js';
import { RavenApiClient } from './api_client.js';
import { publishCourses } from './publish.js';

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
  vi.unstubAllEnvs();
});

describe('scraped course publishing', () => {
  it('publishes and refreshes the same CRN in several catalogs on one server', async () => {
    const { Pool } = newDb().adapters.createPg();
    const db = new Pool();
    await ensureSchema(db);
    server = createApp(db, 'FALL', 2026).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    const api = new RavenApiClient(`http://127.0.0.1:${address.port}/api`, fetch, vi.fn());
    const catalogs = [{ term: 'FALL', year: 2026 }, { term: 'SUMMER', year: 2026 }, { term: 'WINTER', year: 2027 }] as const;
    try {
      for (const catalog of catalogs) {
        const course = { crn: '12345', course_name: `${catalog.term} course`, course_code: 'COMP 1405', section: 'A', credits: 0.5 };
        expect(await publishCourses([course], api, vi.fn(), catalog)).toEqual({ successfulUpdates: 0, successfulAdditions: 1, failedOperations: 0 });
        expect(await publishCourses([{ ...course, instructor: `${catalog.term} instructor` }], api, vi.fn(), catalog)).toEqual({ successfulUpdates: 1, successfulAdditions: 0, failedOperations: 0 });
      }
      for (const catalog of catalogs) {
        const result = await api.getCourses(catalog);
        expect(result.courses).toEqual([expect.objectContaining({ ...catalog, instructor: `${catalog.term} instructor`, course_name: `${catalog.term} course` })]);
      }
      expect((await db.query('SELECT id FROM courses')).rowCount).toBe(3);
    } finally {
      await db.end();
    }
  });

  it.each([
    { term: 'SUMMER', year: 2025 }, { term: 'FALL', year: 2026 }, { term: 'WINTER', year: 2027 },
  ])('adds then updates $term $year courses through the real API using the shared configuration', async ({ term, year }) => {
    vi.stubEnv('ACTIVE_TERM', term);
    vi.stubEnv('ACTIVE_YEAR', String(year));
    const memory = newDb();
    const { Pool } = memory.adapters.createPg();
    const db = new Pool();
    await ensureSchema(db);
    server = createApp(db).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    const api = new RavenApiClient(`http://127.0.0.1:${address.port}/api`, fetch, vi.fn());
    expect(await (await fetch(`http://127.0.0.1:${address.port}/api/catalog`)).json()).toEqual({ term, year, catalogs: [{ term, year }] });
    const course = { crn: '12345', course_name: 'Intro', course_code: 'COMP 1405', section: 'A', credits: 0.5, section_type: 'Online Scheduled Section', meeting_infos: { days: 'Mon', time: '10:00 - 11:00', room: '1' } };
    const log = vi.fn();
    expect(await publishCourses([course], api, log)).toEqual({ successfulUpdates: 0, successfulAdditions: 1, failedOperations: 0 });
    expect(await publishCourses([{ ...course, instructor: 'Grace', section_type: 'Online Unscheduled Section', meeting_infos: { ...course.meeting_infos, room: '2' } }], api, log)).toEqual({ successfulUpdates: 1, successfulAdditions: 0, failedOperations: 0 });
    const result = await api.getCourses();
    expect(result.courses).toEqual([expect.objectContaining({ crn: '12345', instructor: 'Grace', section_type: 'Online Unscheduled Section', also_register_in: '', meetings: [expect.objectContaining({ days: 'Mon', room: '2' })] })]);
    const stored = await db.query('SELECT term, year FROM courses');
    expect(stored.rows).toEqual([{ term, year }]);
    await db.end();
  });

  it('continues after errors and preserves the legacy success and failure counters', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"exists":true}'))
      // The Python updater returned this JSON without raising for HTTP 500.
      .mockResolvedValueOnce(new Response('{"message":"failed"}', { status: 500 }))
      .mockResolvedValueOnce(new Response('invalid json'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('{"exists":false}'))
      .mockResolvedValueOnce(new Response('{"message":"added"}'));
    const api = new RavenApiClient('https://example.test/api', request, vi.fn());
    const log = vi.fn();
    const courses = ['1', '2', '3', '4'].map((crn) => ({ crn, course_name: `Course ${crn}` }));
    expect(await publishCourses(courses, api, log)).toEqual({ successfulUpdates: 1, successfulAdditions: 1, failedOperations: 2 });
    expect(request).toHaveBeenCalledTimes(6);
    expect(log.mock.calls.slice(-4)).toEqual([
      ['Successfully updated 1 courses.'], ['Successfully added 1 new courses.'], ['2 operations failed.'], ['Done'],
    ]);
  });

  it('skips a malformed course while still publishing subsequent courses', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"exists":false}'))
      .mockResolvedValueOnce(new Response('{"message":"added"}'));
    const api = new RavenApiClient('https://example.test/api', request, vi.fn());
    const log = vi.fn();
    expect(await publishCourses([{}, { crn: '12345', course_name: 'Intro' }], api, log)).toEqual({ successfulUpdates: 0, successfulAdditions: 1, failedOperations: 1 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Missing course_name'));
  });
});
