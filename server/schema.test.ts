import { newDb } from 'pg-mem';
import { expect, it } from 'vitest';
import { ensureSchema, schemaSql } from './schema.js';

it('automatically upgrades the old global CRN key, preserves data, and can run repeatedly', async () => {
  // pg-mem skips CREATE TABLE IF NOT EXISTS on repeat runs but still checks its AST.
  const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  const db = new Pool();
  try {
    // Reproduce the previous production schema, including its global CRN key.
    await db.query(schemaSql
      .replace('crn VARCHAR(50) NOT NULL,', 'crn VARCHAR(50) NOT NULL UNIQUE,')
      .replace('CREATE UNIQUE INDEX IF NOT EXISTS courses_catalog_crn_key ON courses (term, year, crn);', '')
      .replace('ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_crn_key;', ''));
    const inserted = await db.query("INSERT INTO courses (crn, term, year) VALUES ('12345', 'FALL', 2026) RETURNING id");
    const id = inserted.rows[0].id;
    await db.query("INSERT INTO meeting_infos (course_id, room) VALUES ($1, 'Original room')", [id]);

    await ensureSchema(db);
    await ensureSchema(db);
    await db.query("INSERT INTO courses (crn, term, year) VALUES ('12345', 'WINTER', 2027)");
    await expect(db.query("INSERT INTO courses (crn, term, year) VALUES ('12345', 'FALL', 2026)")).rejects.toMatchObject({ code: '23505' });
    expect((await db.query('SELECT id FROM courses WHERE term = $1', ['FALL'])).rows).toEqual([{ id }]);
    expect((await db.query('SELECT course_id, room FROM meeting_infos')).rows).toEqual([{ course_id: id, room: 'Original room' }]);
  } finally {
    await db.end();
  }
});
