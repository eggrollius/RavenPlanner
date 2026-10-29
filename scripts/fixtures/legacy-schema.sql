-- Previous production schema: a CRN could only occur once across all catalogs.
CREATE TABLE courses (
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
CREATE TABLE meeting_infos (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  meeting_date VARCHAR(50) NOT NULL DEFAULT '',
  days VARCHAR(50) NOT NULL DEFAULT '',
  time VARCHAR(50) NOT NULL DEFAULT '',
  building VARCHAR(50) NOT NULL DEFAULT '',
  room VARCHAR(50) NOT NULL DEFAULT ''
);
INSERT INTO courses (crn, course_code, section, course_name, term, year)
VALUES ('migration-check', 'TEST 1000', 'A', 'Existing course', 'FALL', 2026);
INSERT INTO meeting_infos (course_id, room) VALUES (1, 'Original room');
