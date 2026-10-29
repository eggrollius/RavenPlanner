import pg from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { generateSchedules, meetingsConflict } from '../src/scheduler.js';
import type { Course, SelectedCourse } from '../src/types.js';
import { seedDevelopmentCatalog } from './dev-catalog.js';
import { startLocalDatabase } from './local-database.js';

describe('local PostgreSQL catalog and planner', () => {
  let database: Awaited<ReturnType<typeof startLocalDatabase>>;
  let pool: pg.Pool;
  const catalog = { term: 'FALL', year: 2026 } as const;

  beforeAll(async () => {
    database = await startLocalDatabase();
    pool = new pg.Pool({ connectionString: database.connectionString });
    await seedDevelopmentCatalog(pool, catalog);
  }, 30000);
  afterAll(async () => {
    await pool?.end();
    await database?.close();
  });

  it('searches the seeded catalog through the real API and generates usable schedules', async () => {
    const app = createApp(pool, catalog.term, catalog.year);
    const selected: SelectedCourse[] = [];
    for (const code of ['COMP 1405', 'MATH 1007', 'PSYC 1001']) {
      const response = await request(app).get('/api/course/search').query({ query: code }).expect(200);
      selected.push({ code, sections: response.body.data, disabled: new Set() });
    }
    expect(selected[0].sections.A.children).toHaveLength(2);
    const schedules = generateSchedules(selected, { beforeEnabled: false, before: '09:00', afterEnabled: false, after: '18:00', prioritizeDaysOff: true });
    expect(schedules.length).toBeGreaterThan(1);
    for (const schedule of schedules) {
      expect(schedule).toHaveLength(3);
      expect(schedule.filter(({ child }) => child)).toHaveLength(2);
      for (let i = 0; i < schedule.length; i++) {
        const left = [schedule[i].parent, schedule[i].child].filter((course): course is Course => Boolean(course));
        for (const right of schedule.slice(i + 1)) {
          for (const course of left) {
            for (const a of course.meeting_infos) {
              for (const b of [...right.parent.meeting_infos, ...(right.child?.meeting_infos || [])]) {
                expect(meetingsConflict(a, b)).toBe(false);
              }
            }
          }
        }
      }
    }
    const list = await request(app).get('/api/courses').expect(200);
    expect(list.body.courses).toHaveLength(36);
    await request(app).get('/api/health').expect(200, { status: 'ok' });
  });

  it('preserves edits on restart and resets courses and meetings on demand', async () => {
    await pool.query("UPDATE courses SET instructor = 'Edited locally' WHERE course_code = 'COMP 1405' AND section = 'A'");
    expect(await seedDevelopmentCatalog(pool, catalog)).toBe(0);
    expect((await pool.query("SELECT instructor FROM courses WHERE course_code = 'COMP 1405' AND section = 'A'")).rows[0].instructor).toBe('Edited locally');
    await seedDevelopmentCatalog(pool, catalog, true);
    expect((await pool.query("SELECT instructor FROM courses WHERE course_code = 'COMP 1405' AND section = 'A'")).rows[0].instructor).toContain('(Demo)');
    expect((await pool.query('SELECT COUNT(*) FROM meeting_infos')).rows[0].count).toBe('36');
  });

  it('seeds another active term without CRN collisions or mixing catalogs', async () => {
    const winter = { term: 'WINTER', year: 2027 } as const;
    await seedDevelopmentCatalog(pool, winter);
    const app = createApp(pool, winter.term, winter.year);
    const response = await request(app).get('/api/course/search').query({ query: 'COMP 1405' }).expect(200);
    expect(response.body.data.A.parent).toMatchObject({ term: 'WINTER', year: 2027 });
    expect(response.body.data.A.parent.meeting_infos[0].meeting_date).toContain('Jan 06, 2027');
    expect((await request(app).get('/api/courses')).body.courses).toHaveLength(36);
  });

  it('supports simultaneous API reads and a transactional write over the PostgreSQL connection', async () => {
    const app = createApp(pool, catalog.term, catalog.year);
    const course = (await request(app).get('/api/course/search').query({ query: 'COMP 1405' })).body.data.A.parent;
    await Promise.all([
      request(app).put(`/api/course/crn/${course.crn}`).send({ instructor: 'Concurrent edit' }).expect(200),
      ...Array.from({ length: 5 }, () => request(app).get('/api/courses').expect(200)),
    ]);
    const response = await request(app).get('/api/course/search').query({ query: 'COMP 1405' }).expect(200);
    expect(response.body.data.A.parent.instructor).toBe('Concurrent edit');
  });
});

it('persists local edits across database shutdown and restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ravenplanner-database-'));
  let database: Awaited<ReturnType<typeof startLocalDatabase>> | undefined;
  let pool: pg.Pool | undefined;
  try {
    database = await startLocalDatabase(directory);
    pool = new pg.Pool({ connectionString: database.connectionString });
    await seedDevelopmentCatalog(pool, { term: 'FALL', year: 2026 });
    await pool.query("UPDATE courses SET instructor = 'Saved locally' WHERE course_code = 'COMP 1405'");
    await pool.end();
    pool = undefined;
    await database.close();
    database = undefined;

    database = await startLocalDatabase(directory);
    pool = new pg.Pool({ connectionString: database.connectionString });
    expect(await seedDevelopmentCatalog(pool, { term: 'FALL', year: 2026 })).toBe(0);
    const response = await request(createApp(pool, 'FALL', 2026)).get('/api/course/search').query({ query: 'COMP 1405' }).expect(200);
    expect(response.body.data.A.parent.instructor).toBe('Saved locally');
    expect(response.body.data.A.children).toHaveLength(2);
  } finally {
    await pool?.end();
    await database?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
