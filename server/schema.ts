import type { Queryable } from './types.js';

export const schemaSql = `
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  registration_status VARCHAR(50) NOT NULL DEFAULT '',
  crn VARCHAR(50) NOT NULL UNIQUE,
  course_code VARCHAR(50) NOT NULL DEFAULT '',
  section VARCHAR(50) NOT NULL DEFAULT '',
  course_name VARCHAR(255) NOT NULL DEFAULT '',
  credits DOUBLE PRECISION NOT NULL DEFAULT 0,
  type VARCHAR(50) NOT NULL DEFAULT '',
  instructor VARCHAR(255) NOT NULL DEFAULT '',
  also_register_in VARCHAR(255) NOT NULL DEFAULT '',
  term VARCHAR(10) NOT NULL,
  year INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS courses_term_search_idx ON courses (term, year, course_code);
CREATE TABLE IF NOT EXISTS meeting_infos (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  meeting_date VARCHAR(50) NOT NULL DEFAULT '',
  days VARCHAR(50) NOT NULL DEFAULT '',
  time VARCHAR(50) NOT NULL DEFAULT '',
  building VARCHAR(50) NOT NULL DEFAULT '',
  room VARCHAR(50) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS meeting_infos_course_idx ON meeting_infos (course_id);
`;

export async function ensureSchema(db: Queryable): Promise<void> {
  await db.query(schemaSql);
}
