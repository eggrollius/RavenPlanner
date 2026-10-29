import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatalog, readCatalog, type Catalog } from './catalog.js';
import { transaction } from './transaction.js';
import type { CourseInput, MeetingInput, Queryable } from './types.js';

const courseColumns = ['registration_status', 'crn', 'course_code', 'section', 'course_name', 'credits', 'type', 'instructor', 'also_register_in', 'term', 'year'] as const;
const meetingColumns = ['meeting_date', 'days', 'time', 'building', 'room'] as const;

type Row = Record<string, unknown> & { id: number; crn: string; section: string; meeting_infos?: MeetingInput[] };

const asMeetings = (value?: MeetingInput | MeetingInput[]) => value ? (Array.isArray(value) ? value : [value]) : [];
const value = (body: CourseInput, key: typeof courseColumns[number], term: string, year: number) => {
  if (key === 'term') return term;
  if (key === 'year') return year;
  if (key === 'credits') return body.credits ?? 0;
  return body[key] ?? '';
};

async function meetingsFor(db: Queryable, ids: number[]) {
  if (!ids.length) return new Map<number, MeetingInput[]>();
  const result = await db.query<MeetingInput & { course_id: number }>(
    `SELECT course_id, meeting_date, days, time, building, room FROM meeting_infos WHERE course_id IN (${ids.map((_, index) => `$${index + 1}`).join(', ')}) ORDER BY id`, ids
  );
  const grouped = new Map<number, MeetingInput[]>();
  for (const row of result.rows) grouped.set(row.course_id, [...(grouped.get(row.course_id) || []), row]);
  return grouped;
}

export function createApp(db: Queryable, activeTerm = readCatalog().term, activeYear = readCatalog().year) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/catalog', async (_req, res, next) => {
    try {
      const result = await db.query<Catalog>('SELECT DISTINCT term, year FROM courses ORDER BY year DESC, term');
      const catalogs = new Map<string, Catalog>();
      for (const row of [{ term: activeTerm, year: activeYear }, ...result.rows]) {
        const catalog = parseCatalog(row.term, row.year);
        catalogs.set(`${catalog.term}-${catalog.year}`, catalog);
      }
      res.json({ term: activeTerm, year: activeYear, catalogs: [...catalogs.values()] });
    } catch (error) { next(error); }
  });

  app.use(['/api/course', '/api/courses'], (req, res, next) => {
    try {
      const hasQuery = req.query.term !== undefined || req.query.year !== undefined;
      const hasBody = ['POST', 'PUT'].includes(req.method) && (req.body?.term !== undefined || req.body?.year !== undefined);
      const queryCatalog = hasQuery ? parseCatalog(req.query.term, req.query.year) : undefined;
      const bodyCatalog = hasBody ? parseCatalog(req.body.term, req.body.year) : undefined;
      if (queryCatalog && bodyCatalog && (queryCatalog.term !== bodyCatalog.term || queryCatalog.year !== bodyCatalog.year)) {
        throw new Error('Query and body must select the same term and year.');
      }
      res.locals.catalog = queryCatalog || bodyCatalog || { term: activeTerm, year: activeYear };
      next();
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid term or year.' });
    }
  });

  app.get('/api/health', async (_req, res, next) => {
    try { await db.query('SELECT 1'); res.json({ status: 'ok' }); } catch (error) { next(error); }
  });

  app.post('/api/course', async (req, res, next) => {
    const body = req.body as CourseInput;
    if (!body?.crn) return res.status(400).json({ message: 'crn is required' });
    const { term, year } = res.locals.catalog as Catalog;
    try {
      await transaction(db, async (connection) => {
        const params = courseColumns.map((key) => value(body, key, term, year));
        const inserted = await connection.query<{ id: number }>(`INSERT INTO courses (${courseColumns.join(', ')}) VALUES (${params.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, params);
        for (const meeting of asMeetings(body.meeting_infos)) await connection.query(`INSERT INTO meeting_infos (course_id, ${meetingColumns.join(', ')}) VALUES ($1, $2, $3, $4, $5, $6)`, [inserted.rows[0].id, ...meetingColumns.map((key) => meeting[key] ?? '')]);
      });
      res.json({ message: 'New course added' });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return res.json({ message: 'CRN already exists, duplicate' });
      next(error);
    }
  });

  app.get('/api/courses', async (_req, res, next) => {
    const { term, year } = res.locals.catalog as Catalog;
    try {
      const result = await db.query<Row>('SELECT * FROM courses WHERE term = $1 AND year = $2 ORDER BY course_code, section', [term, year]);
      const grouped = await meetingsFor(db, result.rows.map(({ id }) => id));
      res.json({ courses: result.rows.map(({ id, ...course }) => ({ ...course, meetings: grouped.get(id) || [] })) });
    } catch (error) { next(error); }
  });

  app.get('/api/course/search', async (req, res, next) => {
    const { term, year } = res.locals.catalog as Catalog;
    const query = String(req.query.query || '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!query) return res.status(400).json({ status: 'error', message: 'A course code is required' });
    try {
      const result = await db.query<Row>('SELECT * FROM courses WHERE UPPER(course_code) = $1 AND term = $2 AND year = $3 ORDER BY section', [query, term, year]);
      if (!result.rows.length) return res.status(400).json({ status: 'error', message: 'No course found matching the query' });
      const grouped = await meetingsFor(db, result.rows.map(({ id }) => id));
      const courses = result.rows.map((course) => ({ ...course, meeting_infos: grouped.get(course.id) || [] }));
      const data: Record<string, { parent: Row; children: Row[] }> = {};
      for (const course of courses.filter(({ section }) => section.length === 1)) data[course.section] = { parent: course, children: [] };
      for (const course of courses.filter(({ section }) => section.length > 1)) data[course.section[0]]?.children.push(course);
      res.json({ status: 'success', message: 'successfully searched for course', data });
    } catch (error) { next(error); }
  });

  app.get('/api/course/exists/:crn', async (req, res, next) => {
    const { term, year } = res.locals.catalog as Catalog;
    try {
      const result = await db.query('SELECT id FROM courses WHERE crn = $1 AND term = $2 AND year = $3 LIMIT 1', [req.params.crn, term, year]);
      const exists = Boolean(result.rowCount);
      res.json({ message: exists ? 'Course exists' : 'Course does not exist', exists });
    } catch (error) { next(error); }
  });

  app.put('/api/course/crn/:crn', async (req, res, next) => {
    const body = req.body as CourseInput;
    const { term, year } = res.locals.catalog as Catalog;
    try {
      const updated = await transaction(db, async (connection) => {
        const found = await connection.query<{ id: number }>('SELECT id FROM courses WHERE crn = $1 AND term = $2 AND year = $3', [req.params.crn, term, year]);
        if (!found.rowCount) return false;
        const mutable = courseColumns.filter((key) => !['crn', 'term', 'year'].includes(key) && body[key] !== undefined);
        if (mutable.length) await connection.query(`UPDATE courses SET ${mutable.map((key, i) => `${key} = $${i + 1}`).join(', ')} WHERE id = $${mutable.length + 1}`, [...mutable.map((key) => body[key]), found.rows[0].id]);
        if (body.meeting_infos !== undefined) {
          await connection.query('DELETE FROM meeting_infos WHERE course_id = $1', [found.rows[0].id]);
          for (const meeting of asMeetings(body.meeting_infos)) await connection.query(`INSERT INTO meeting_infos (course_id, ${meetingColumns.join(', ')}) VALUES ($1, $2, $3, $4, $5, $6)`, [found.rows[0].id, ...meetingColumns.map((key) => meeting[key] ?? '')]);
        }
        return true;
      });
      if (!updated) return res.status(404).json({ message: 'Course not found' });
      res.json({ message: 'Course and meeting info updated' });
    } catch (error) { next(error); }
  });

  const remove = (byCrn: boolean) => async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const { term, year } = res.locals.catalog as Catalog;
    try {
      const field = byCrn ? 'crn' : 'id';
      const result = await db.query(`DELETE FROM courses WHERE ${field} = $1 AND term = $2 AND year = $3`, [byCrn ? req.params.crn : Number(req.params.id), term, year]);
      if (!result.rowCount) return res.status(404).json({ message: 'Course not found' });
      res.json({ message: 'Course deleted' });
    } catch (error) { next(error); }
  };
  app.delete('/api/course/crn/:crn', remove(true));
  app.delete('/api/course/:id', remove(false));

  const clientPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');
  app.use(express.static(clientPath));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientPath, 'index.html')));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  });
  return app;
}
