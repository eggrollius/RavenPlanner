import { describe, expect, it } from 'vitest';
import { generateSchedules, meetingsConflict } from './scheduler';
import type { Course, MeetingInfo, SelectedCourse } from './types';

const meeting = (days: string, time: string): MeetingInfo => ({ days, time, meeting_date: 'May 05, 2025 to Jun 16, 2025', building: '', room: '' });
const course = (crn: string, code: string, section: string, info: MeetingInfo): Course => ({ id: Number(crn), crn, course_code: code, section, meeting_infos: [info], registration_status: 'Open', course_name: code, credits: 0.5, type: 'Lecture', instructor: '', also_register_in: '' });
describe('scheduler', () => {
  it('detects overlap only on shared days, dates, and times', () => { expect(meetingsConflict(meeting('Mon Wed', '09:00 - 10:00'), meeting('Wed', '09:30 - 11:00'))).toBe(true); expect(meetingsConflict(meeting('Mon', '09:00 - 10:00'), meeting('Tue', '09:30 - 11:00'))).toBe(false); expect(meetingsConflict(meeting('Mon', '09:00 - 10:00'), meeting('Mon', '10:00 - 11:00'))).toBe(false); });
  it('generates only conflict-free combinations', () => { const a = course('1', 'COMP 1000', 'A', meeting('Mon', '09:00 - 10:00')); const b = course('2', 'MATH 1000', 'A', meeting('Mon', '09:30 - 10:30')); const c = course('3', 'MATH 1000', 'B', meeting('Tue', '09:30 - 10:30')); const selected: SelectedCourse[] = [{ code: a.course_code, sections: { A: { parent: a, children: [] } }, disabled: new Set() }, { code: b.course_code, sections: { A: { parent: b, children: [] }, B: { parent: c, children: [] } }, disabled: new Set() }]; expect(generateSchedules(selected, { beforeEnabled: false, before: '09:00', afterEnabled: false, after: '18:00', prioritizeDaysOff: false })).toHaveLength(1); });
});
