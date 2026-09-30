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
  it('supports the scraper create, exists, search, update, list, and delete flow', async () => { await request(app).post('/api/course').send(payload).expect(200, { message: 'New course added' }); expect((await request(app).get('/api/course/exists/12345').expect(200)).body.exists).toBe(true); const search = await request(app).get('/api/course/search').query({ query: 'comp 1405' }).expect(200); expect(search.body.data.A.parent.meeting_infos[0].days).toBe('Mon Wed'); await request(app).put('/api/course/crn/12345').send({ instructor: 'Grace', meeting_infos: payload.meeting_infos }).expect(200); const list = await request(app).get('/api/courses').expect(200); expect(list.body.courses[0]).toMatchObject({ instructor: 'Grace', meetings: [expect.objectContaining({ room: '1' })] }); await request(app).delete('/api/course/crn/12345').expect(200); });
  it('rejects missing course codes and reports duplicates without breaking the legacy contract', async () => { await request(app).get('/api/course/search').expect(400); await request(app).post('/api/course').send(payload).expect(200); await request(app).post('/api/course').send(payload).expect(200, { message: 'CRN already exists, duplicate' }); });
});
