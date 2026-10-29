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
});

describe('scraped course publishing', () => {
  it('adds then updates through the real Express API without changing payloads or meetings', async () => {
    const memory = newDb();
    const { Pool } = memory.adapters.createPg();
    const db = new Pool();
    await ensureSchema(db);
    server = createApp(db, 'SUMMER', 2025).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    const api = new RavenApiClient(`http://127.0.0.1:${address.port}/api`, fetch, vi.fn());
    const course = { crn: '12345', course_name: 'Intro', course_code: 'COMP 1405', section: 'A', credits: 0.5, meeting_infos: { days: 'Mon', time: '10:00 - 11:00', room: '1' } };
    const log = vi.fn();
    expect(await publishCourses([course], api, log)).toEqual({ successfulUpdates: 0, successfulAdditions: 1, failedOperations: 0 });
    expect(await publishCourses([{ ...course, instructor: 'Grace', meeting_infos: { ...course.meeting_infos, room: '2' } }], api, log)).toEqual({ successfulUpdates: 1, successfulAdditions: 0, failedOperations: 0 });
    const result = await api.getCourses();
    expect(result.courses).toEqual([expect.objectContaining({ crn: '12345', instructor: 'Grace', also_register_in: '', meetings: [expect.objectContaining({ days: 'Mon', room: '2' })] })]);
    const stored = await db.query('SELECT term, year FROM courses');
    expect(stored.rows).toEqual([{ term: 'SUMMER', year: 2025 }]);
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
});
