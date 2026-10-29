// @vitest-environment node
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

it('automatically migrates an existing catalog without backfilling or changing its data, and can run again', async () => {
  // pg-mem otherwise rejects constraints in CREATE TABLE IF NOT EXISTS when
  // that table already exists; PostgreSQL correctly treats it as a no-op.
  const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  const db = new Pool();
  try {
    await db.query(`CREATE TABLE courses (
      id SERIAL PRIMARY KEY, crn VARCHAR(50) NOT NULL UNIQUE,
      course_code VARCHAR(50) NOT NULL, section VARCHAR(50) NOT NULL,
      term VARCHAR(10) NOT NULL, year INTEGER NOT NULL
    );
    INSERT INTO courses (crn, course_code, section, term, year)
      VALUES ('12345', 'COMP 1405', 'A', 'FALL', 2026);`);
    const before = (await db.query('SELECT * FROM courses')).rows;
    await ensureSchema(db);
    expect((await db.query('SELECT * FROM courses')).rows).toEqual(before.map((row) => ({ ...row, section_type: null })));
    await db.query('UPDATE courses SET section_type = $1 WHERE crn = $2', ['Online Unscheduled Section', '12345']);
    await ensureSchema(db);
    expect((await db.query('SELECT * FROM courses')).rows).toEqual(before.map((row) => ({ ...row, section_type: 'Online Unscheduled Section' })));
    expect((await db.query('SELECT * FROM meeting_infos')).rows).toEqual([]);
  } finally {
    await db.end();
  }
});
