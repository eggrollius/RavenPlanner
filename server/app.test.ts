// @vitest-environment node
import { newDb } from 'pg-mem';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { ensureSchema } from './schema';

let app: ReturnType<typeof createApp>;
beforeEach(async () => { const memory = newDb(); const { Pool } = memory.adapters.createPg(); const pool = new Pool(); await ensureSchema(pool); app = createApp(pool, 'SUMMER', 2025); });
const payload = { registration_status: 'Open', crn: '12345', course_code: 'COMP 1405', section: 'A', course_name: 'Intro', credits: 0.5, type: 'Lecture', instructor: 'Ada', also_register_in: '', term: 'SUMMER', year: 2025, meeting_infos: { meeting_date: 'May 05, 2025 to Jun 16, 2025', days: 'Mon Wed', time: '10:00 - 11:00', building: 'HP', room: '1' } };
describe('course API compatibility', () => {
  it('reports the active catalog for the planner', async () => {
    await request(app).get('/api/catalog').expect(200, { term: 'SUMMER', year: 2025, catalogs: [{ term: 'SUMMER', year: 2025 }] });
  });
  it('supports the scraper create, exists, search, update, list, and delete flow', async () => { await request(app).post('/api/course').send(payload).expect(200, { message: 'New course added' }); expect((await request(app).get('/api/course/exists/12345').expect(200)).body.exists).toBe(true); const search = await request(app).get('/api/course/search').query({ query: 'comp 1405' }).expect(200); expect(search.body.data.A.parent.meeting_infos[0].days).toBe('Mon Wed'); await request(app).put('/api/course/crn/12345').send({ instructor: 'Grace', meeting_infos: payload.meeting_infos }).expect(200); const list = await request(app).get('/api/courses').expect(200); expect(list.body.courses[0]).toMatchObject({ instructor: 'Grace', meetings: [expect.objectContaining({ room: '1' })] }); await request(app).delete('/api/course/crn/12345').expect(200); });
  it('rejects missing course codes and reports duplicates without breaking the legacy contract', async () => { await request(app).get('/api/course/search').expect(400); await request(app).post('/api/course').send(payload).expect(200); await request(app).post('/api/course').send(payload).expect(200, { message: 'CRN already exists, duplicate' }); });
  it('persists section delivery types independently of meeting rows and supports updates and clearing', async () => {
    const sectionType = 'Online Unscheduled Section with In-Person Assessments (Campus presence)';
    await request(app).post('/api/course').send({ ...payload, section_type: sectionType, meeting_infos: [] }).expect(200);
    await request(app).post('/api/course').send({ ...payload, crn: '12346', section: 'A1', section_type: 'In-person section (Campus presence)' }).expect(200);
    const search = await request(app).get('/api/course/search').query({ query: 'COMP 1405' }).expect(200);
    expect(search.body.data.A.parent).toMatchObject({ section_type: sectionType, meeting_infos: [] });
    expect(search.body.data.A.children[0]).toMatchObject({ section_type: 'In-person section (Campus presence)', meeting_infos: [expect.objectContaining({ days: 'Mon Wed' })] });
    await request(app).put('/api/course/crn/12345').send({ instructor: 'Grace' }).expect(200);
    expect((await request(app).get('/api/courses')).body.courses[0].section_type).toBe(sectionType);
    await request(app).put('/api/course/crn/12345').send({ section_type: 'Online Scheduled Section' }).expect(200);
    expect((await request(app).get('/api/courses')).body.courses[0].section_type).toBe('Online Scheduled Section');
    await request(app).put('/api/course/crn/12345').send({ section_type: null }).expect(200);
    expect((await request(app).get('/api/courses')).body.courses[0].section_type).toBeNull();
  });
  it('does not invent a delivery type when the scraper has not supplied one', async () => {
    await request(app).post('/api/course').send(payload).expect(200);
    const search = await request(app).get('/api/course/search').query({ query: 'COMP 1405' }).expect(200);
    expect(search.body.data.A.parent.section_type).toBeNull();
  });
});

describe('multiple catalogs', () => {
  const catalogs = [
    { term: 'FALL', year: 2026 }, { term: 'SUMMER', year: 2026 },
    { term: 'WINTER', year: 2026 }, { term: 'WINTER', year: 2027 },
  ];

  it('stores reused CRNs across terms and years while rejecting duplicates within a catalog', async () => {
    for (const catalog of catalogs) {
      await request(app).post('/api/course').send({ ...payload, ...catalog, instructor: `${catalog.term} ${catalog.year}` }).expect(200, { message: 'New course added' });
      await request(app).post('/api/course').send({ ...payload, ...catalog }).expect(200, { message: 'CRN already exists, duplicate' });
    }
    for (const catalog of catalogs) {
      const list = await request(app).get('/api/courses').query(catalog).expect(200);
      expect(list.body.courses).toHaveLength(1);
      expect(list.body.courses[0]).toMatchObject({ ...catalog, instructor: `${catalog.term} ${catalog.year}` });
      const search = await request(app).get('/api/course/search').query({ ...catalog, query: 'COMP 1405' }).expect(200);
      expect(search.body.data.A.parent).toMatchObject(catalog);
      await request(app).get('/api/course/exists/12345').query(catalog).expect(200, { exists: true, message: 'Course exists' });
    }
    expect((await request(app).get('/api/courses')).body.courses).toEqual([]);
    const available = (await request(app).get('/api/catalog').expect(200)).body;
    expect(available).toMatchObject({ term: 'SUMMER', year: 2025 });
    expect(available.catalogs).toHaveLength(5);
    expect(available.catalogs).toEqual(expect.arrayContaining(catalogs));
  });

  it('isolates updates and deletes, including meeting rows, to the selected catalog', async () => {
    for (const catalog of catalogs) await request(app).post('/api/course').send({ ...payload, ...catalog }).expect(200);
    const winter = { term: 'WINTER', year: 2027 };
    await request(app).put('/api/course/crn/12345').send({ ...winter, instructor: 'Winter only', meeting_infos: { room: 'Winter room' } }).expect(200);
    for (const catalog of catalogs) {
      const course = (await request(app).get('/api/course/search').query({ ...catalog, query: 'COMP 1405' })).body.data.A.parent;
      expect(course.instructor).toBe(catalog.year === 2027 ? 'Winter only' : 'Ada');
      expect(course.meeting_infos[0].room).toBe(catalog.year === 2027 ? 'Winter room' : '1');
    }
    const summer = { term: 'SUMMER', year: 2026 };
    const summerId = (await request(app).get('/api/course/search').query({ ...summer, query: 'COMP 1405' })).body.data.A.parent.id;
    await request(app).delete(`/api/course/${summerId}`).query(winter).expect(404);
    await request(app).delete(`/api/course/${summerId}`).query(summer).expect(200);
    await request(app).delete('/api/course/crn/12345').query(winter).expect(200);
    await request(app).get('/api/course/exists/12345').query(winter).expect(200, { exists: false, message: 'Course does not exist' });
    expect((await request(app).get('/api/courses').query(catalogs[0])).body.courses).toHaveLength(1);
  });

  it('normalizes selectors and rejects invalid, incomplete, or conflicting catalog selectors', async () => {
    await request(app).post('/api/course').send({ ...payload, term: ' fall ', year: '2026' }).expect(200);
    expect((await request(app).get('/api/courses').query({ term: 'fall', year: 2026 })).body.courses[0].term).toBe('FALL');
    for (const invalid of [{ term: 'SPRING', year: 2026 }, { term: 'FALL' }, { year: 2026 }, { term: 'FALL', year: '2e3' }, { term: ['FALL', 'WINTER'], year: 2026 }]) {
      await request(app).get('/api/courses').query(invalid).expect(400);
      await request(app).post('/api/course').send({ ...payload, term: undefined, year: undefined, ...invalid }).expect(400);
    }
    await request(app).put('/api/course/crn/12345').query({ term: 'FALL', year: 2026 }).send({ term: 'WINTER', year: 2027 }).expect(400);
    await request(app).get('/api/course/exists/12345').query({ term: 'FALL', year: 2026 }).expect(200, { exists: true, message: 'Course exists' });
  });
});
