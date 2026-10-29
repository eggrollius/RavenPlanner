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
      .replace('also_register_in TEXT', 'also_register_in VARCHAR(255)')
      .replace('ALTER TABLE courses ALTER COLUMN also_register_in TYPE TEXT;', '')
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
      also_register_in VARCHAR(255) NOT NULL DEFAULT '',
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

it('upgrades registration lists without truncation and retains all linked sections', async () => {
  const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  const db = new Pool();
  try {
    await db.query(schemaSql.replace('also_register_in TEXT', 'also_register_in VARCHAR(255)')
      .replace('ALTER TABLE courses ALTER COLUMN also_register_in TYPE TEXT;', ''));
    await db.query("INSERT INTO courses (crn, term, year, also_register_in) VALUES ('13599', 'WINTER', 2027, 'PHYS 1004 L1A')");
    await ensureSchema(db);
    expect((await db.query('SELECT also_register_in FROM courses')).rows).toEqual([{ also_register_in: 'PHYS 1004 L1A' }]);
    const sections = ['1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D', '3A', '3B', '4A', '4B', '5A', '5B', '6A', '6B', '7A', '7B', '8A', '8B', '9A', '9B', '9C', '9D'];
    const links = sections.map(section => `PHYS 1004 L${section}`).join(',');
    expect(links).toHaveLength(335);
    await db.query('UPDATE courses SET also_register_in = $1', [links]);
    await ensureSchema(db);
    expect((await db.query('SELECT also_register_in FROM courses')).rows).toEqual([{ also_register_in: links }]);
  } finally {
    await db.end();
  }
});
