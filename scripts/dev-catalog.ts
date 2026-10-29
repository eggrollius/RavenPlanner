import type { Catalog } from '../server/catalog.js';
import type { CourseInput, MeetingInput, Queryable } from '../server/types.js';
import { ensureSchema } from '../server/schema.js';

// Synthetic data: deliberately includes alternative sections, conflicts, labs,
// tutorials, early/evening classes, and an unscheduled online course.
export function developmentCatalog(catalog: Catalog): CourseInput[] {
  const dates = {
    WINTER: `Jan 06, ${catalog.year} to Apr 10, ${catalog.year}`,
    SUMMER: `May 05, ${catalog.year} to Aug 15, ${catalog.year}`,
    FALL: `Sep 08, ${catalog.year} to Dec 08, ${catalog.year}`,
  };
  const courses: CourseInput[] = [];
  const add = (code: string, name: string, section: string, days: string, time: string, type = 'Lecture') => {
    const prefix = `${catalog.year}${{ WINTER: '10', SUMMER: '20', FALL: '30' }[catalog.term]}`;
    courses.push({
      ...catalog,
      crn: `${prefix}${String(courses.length + 1).padStart(4, '0')}`,
      course_code: code,
      course_name: name,
      section,
      registration_status: 'Open',
      credits: type === 'Lecture' ? 0.5 : 0,
      type,
      section_type: days ? 'In Person' : 'Online Unscheduled',
      instructor: ['Alex Morgan (Demo)', 'Sam Chen (Demo)', 'Jordan Lee (Demo)'][courses.length % 3],
      also_register_in: type === 'Lecture' && ['COMP 1405', 'COMP 1406', 'MATH 1007', 'MATH 1104', 'PHYS 1001'].includes(code) ? `${section}1 or ${section}2` : '',
      meeting_infos: [{ meeting_date: dates[catalog.term], days, time, building: days ? 'HP' : 'Online', room: days ? '150' : '' }],
    });
  };

  add('COMP 1405', 'Introduction to Computer Science I', 'A', 'Mon Wed', '09:00 - 10:30');
  add('COMP 1405', 'Introduction to Computer Science I', 'A1', 'Tue', '10:00 - 11:00', 'Tutorial');
  add('COMP 1405', 'Introduction to Computer Science I', 'A2', 'Thu', '14:00 - 15:00', 'Tutorial');
  add('COMP 1405', 'Introduction to Computer Science I', 'B', 'Tue Thu', '13:00 - 14:30');
  add('COMP 1405', 'Introduction to Computer Science I', 'B1', 'Wed', '11:00 - 12:00', 'Tutorial');
  add('COMP 1405', 'Introduction to Computer Science I', 'B2', 'Fri', '09:00 - 10:00', 'Tutorial');
  add('COMP 1406', 'Introduction to Computer Science II', 'A', 'Mon Wed', '10:30 - 12:00');
  add('COMP 1406', 'Introduction to Computer Science II', 'A1', 'Tue', '15:00 - 16:00', 'Tutorial');
  add('COMP 1406', 'Introduction to Computer Science II', 'A2', 'Thu', '09:00 - 10:00', 'Tutorial');
  add('COMP 1406', 'Introduction to Computer Science II', 'B', 'Tue Thu', '18:00 - 19:30');
  add('COMP 1406', 'Introduction to Computer Science II', 'B1', 'Wed', '15:00 - 16:00', 'Tutorial');
  add('COMP 1406', 'Introduction to Computer Science II', 'B2', 'Fri', '12:00 - 13:00', 'Tutorial');
  for (const [code, name, times] of [
    ['MATH 1007', 'Elementary Calculus I', ['09:30 - 11:00', '11:30 - 13:00']],
    ['MATH 1104', 'Linear Algebra for Engineering or Science', ['13:00 - 14:30', '08:30 - 10:00']],
  ] as const) {
    add(code, name, 'A', 'Mon Wed', times[0]);
    add(code, name, 'A1', 'Fri', '10:00 - 11:00', 'Tutorial');
    add(code, name, 'A2', 'Thu', '16:00 - 17:00', 'Tutorial');
    add(code, name, 'B', 'Tue Thu', times[1]);
    add(code, name, 'B1', 'Mon', '16:00 - 17:00', 'Tutorial');
    add(code, name, 'B2', 'Wed', '14:30 - 15:30', 'Tutorial');
  }
  add('PHYS 1001', 'Foundations of Physics I', 'A', 'Mon Wed', '14:30 - 16:00');
  add('PHYS 1001', 'Foundations of Physics I', 'A1', 'Tue', '09:00 - 12:00', 'Laboratory');
  add('PHYS 1001', 'Foundations of Physics I', 'A2', 'Fri', '13:00 - 16:00', 'Laboratory');
  add('PSYC 1001', 'Introduction to Psychology I', 'A', 'Tue Thu', '10:00 - 11:30');
  add('PSYC 1001', 'Introduction to Psychology I', 'B', 'Mon', '18:00 - 21:00');
  add('ECON 1001', 'Introduction to Microeconomics', 'A', 'Mon Wed', '12:00 - 13:30');
  add('ECON 1001', 'Introduction to Microeconomics', 'B', 'Tue Thu', '14:30 - 16:00');
  add('BUSI 1001', 'Financial Accounting for Business Students', 'A', 'Wed', '18:00 - 21:00');
  add('STAT 2507', 'Introduction to Statistical Modeling I', 'A', 'Mon Wed', '16:00 - 17:30');
  add('CGSC 1001', 'Mysteries of the Mind', 'A', '', 'TBA');
  add('ERTH 1006', 'Earth Science Elective (Demo)', 'A', 'Tue', '13:00 - 16:00');
  add('ERTH 1006', 'Earth Science Elective (Demo)', 'B', 'Wed', '12:00 - 13:30');
  return courses;
}

export async function seedDevelopmentCatalog(db: Queryable, catalog: Catalog, reset = false): Promise<number> {
  await ensureSchema(db);
  const connection = db.connect ? await db.connect() : db;
  try {
    await connection.query('BEGIN');
    if (reset) await connection.query('TRUNCATE courses RESTART IDENTITY CASCADE');
    const existing = await connection.query('SELECT id FROM courses WHERE term = $1 AND year = $2 LIMIT 1', [catalog.term, catalog.year]);
    if (existing.rowCount) {
      await connection.query('COMMIT');
      return 0;
    }
    const courses = developmentCatalog(catalog);
    for (const course of courses) {
      const result = await connection.query<{ id: number }>(
        `INSERT INTO courses (registration_status, crn, course_code, section, course_name, credits, type, section_type, instructor, also_register_in, term, year)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [course.registration_status, course.crn, course.course_code, course.section, course.course_name, course.credits, course.type, course.section_type, course.instructor, course.also_register_in, catalog.term, catalog.year],
      );
      for (const meeting of course.meeting_infos as MeetingInput[]) {
        await connection.query(
          'INSERT INTO meeting_infos (course_id, meeting_date, days, time, building, room) VALUES ($1, $2, $3, $4, $5, $6)',
          [result.rows[0].id, meeting.meeting_date, meeting.days, meeting.time, meeting.building, meeting.room],
        );
      }
    }
    await connection.query('COMMIT');
    return courses.length;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    if ('release' in connection) connection.release();
  }
}
