import { describe, expect, it } from 'vitest';
import { generateSchedules, isUnscheduled, meetingsConflict, timeRange } from './scheduler';
import type { Course, MeetingInfo, Preferences, SelectedCourse } from './types';

const meeting = (days: string, time: string): MeetingInfo => ({ days, time, meeting_date: 'May 05, 2025 to Jun 16, 2025', building: '', room: '' });
const course = (crn: string, code: string, section: string, info: MeetingInfo): Course => ({ term: 'SUMMER', year: 2025, id: Number(crn), crn, course_code: code, section, meeting_infos: [info], registration_status: 'Open', course_name: code, credits: 0.5, type: 'Lecture', instructor: '', also_register_in: '' });
const preferences: Preferences = { beforeEnabled: false, before: '09:00', afterEnabled: false, after: '18:00', prioritizeDaysOff: false };

function linkedCourse(type: string): SelectedCourse {
  const parent = course('1', 'COMP 1405', 'A', meeting('Mon', '09:00 - 10:00'));
  const child = { ...course('2', 'COMP 1405', 'A1', meeting('Tue', '10:00 - 11:00')), type };
  return { code: parent.course_code, sections: { A: { parent, children: [child] } }, disabled: new Set() };
}
describe('scheduler', () => {
  it('parses valid time ranges and rejects incomplete values', () => {
    expect(timeRange(meeting('Mon', '09:30 - 11:00'))).toEqual([570, 660]);
    expect(timeRange(meeting('Mon', 'TBA'))).toBeNull();
  });
  it('detects overlap only on shared days, dates, and times', () => { expect(meetingsConflict(meeting('Mon Wed', '09:00 - 10:00'), meeting('Wed', '09:30 - 11:00'))).toBe(true); expect(meetingsConflict(meeting('Mon', '09:00 - 10:00'), meeting('Tue', '09:30 - 11:00'))).toBe(false); expect(meetingsConflict(meeting('Mon', '09:00 - 10:00'), meeting('Mon', '10:00 - 11:00'))).toBe(false); });
  it('generates only conflict-free combinations', () => { const a = course('1', 'COMP 1000', 'A', meeting('Mon', '09:00 - 10:00')); const b = course('2', 'MATH 1000', 'A', meeting('Mon', '09:30 - 10:30')); const c = course('3', 'MATH 1000', 'B', meeting('Tue', '09:30 - 10:30')); const selected: SelectedCourse[] = [{ code: a.course_code, sections: { A: { parent: a, children: [] } }, disabled: new Set() }, { code: b.course_code, sections: { A: { parent: b, children: [] }, B: { parent: c, children: [] } }, disabled: new Set() }]; expect(generateSchedules(selected, { beforeEnabled: false, before: '09:00', afterEnabled: false, after: '18:00', prioritizeDaysOff: false })).toHaveLength(1); });

  it.each(['Tutorial', 'Lab'])('requires an enabled %s for a lecture with linked sections', (type) => {
    const selected = linkedCourse(type);
    const { parent, children: [child] } = selected.sections.A;
    expect(generateSchedules([selected], preferences)).toEqual([[{ parent, child }]]);
    selected.disabled.add(child.crn);
    expect(generateSchedules([selected], preferences)).toEqual([]);
    selected.disabled.delete(child.crn);
    expect(generateSchedules([selected], preferences)).toEqual([[{ parent, child }]]);
  });

  it('uses remaining tutorials and rejects the lecture when every tutorial is disabled', () => {
    const selected = linkedCourse('Tutorial');
    const second = { ...selected.sections.A.children[0], id: 3, crn: '3', section: 'A2' };
    selected.sections.A.children.push(second);
    selected.disabled.add('2');
    expect(generateSchedules([selected], preferences)).toEqual([[{ parent: selected.sections.A.parent, child: second }]]);
    selected.disabled.add(second.crn);
    expect(generateSchedules([selected], preferences)).toEqual([]);
  });

  it('can use another lecture with an enabled lab when one lecture has no enabled labs', () => {
    const selected = linkedCourse('Lab');
    const parent = { ...selected.sections.A.parent, id: 3, crn: '3', section: 'B' };
    const child = { ...selected.sections.A.children[0], id: 4, crn: '4', section: 'B1' };
    selected.sections.B = { parent, children: [child] };
    selected.disabled.add('2');
    expect(generateSchedules([selected], preferences)).toEqual([[{ parent, child }]]);
  });

  it('rejects a schedule when the required tutorial conflicts with another selected course', () => {
    const selected = linkedCourse('Tutorial');
    const parent = course('3', 'MATH 1007', 'A', meeting('Tue', '10:30 - 11:30'));
    const other: SelectedCourse = { code: parent.course_code, sections: { A: { parent, children: [] } }, disabled: new Set() };
    expect(generateSchedules([selected, other], preferences)).toEqual([]);
    expect(generateSchedules([other, selected], preferences)).toEqual([]);
  });

  it('allows lectures that have no linked tutorials or labs', () => {
    const selected = linkedCourse('Tutorial');
    selected.sections.A.children = [];
    expect(generateSchedules([selected], preferences)).toEqual([[{ parent: selected.sections.A.parent }]]);
  });
});

const select = (...courses: Course[]): SelectedCourse => ({ code: courses[0].course_code, sections: Object.fromEntries(courses.map((parent) => [parent.section, { parent, children: [] }])), disabled: new Set() });

describe('unscheduled sections', () => {
  it.each([
    ['Online Unscheduled Section (Campus presence is not required)', true],
    [' ONLINE\nUNSCHEDULED SECTION WITH IN-PERSON ASSESSMENTS (campus presence)', true],
    ['Online Scheduled Section (Campus presence is not required)', false],
    ['Online Scheduled Section with In-Person Assessments (Campus presence)', false],
    ['MIX OF IN-PERSON AND ONLINE SECTION (campus presence)', false],
    ['In-person section (Campus presence)', false],
    ['In-person section (Optional campus presence)', false],
    [null, false], [undefined, false], ['', false],
  ])('classifies %s from the observed label', (section_type, expected) => {
    expect(isUnscheduled({ ...course('1', 'COMP 1405', 'A', meeting('', '')), section_type })).toBe(expected);
  });

  it('keeps an unscheduled lecture and its scheduled tutorial, excluding only the lecture from conflicts', () => {
    const parent = { ...course('1', 'COMP 1405', 'A', meeting('Mon Wed', '09:00 - 11:00')), section_type: 'Online Unscheduled Section' };
    const child = { ...course('2', 'COMP 1405', 'A1', meeting('Wed', '09:00 - 10:00')), section_type: 'In-person section' };
    const selected: SelectedCourse = { ...select(parent), sections: { A: { parent, children: [child] } } };
    const other = course('3', 'MATH 1000', 'A', meeting('Mon', '09:00 - 10:00'));
    expect(generateSchedules([selected, select(other)], preferences)[0]).toEqual([{ parent, child }, { parent: other }]);
    expect(generateSchedules([selected, select({ ...other, meeting_infos: [meeting('Wed', '09:00 - 10:00')] })], preferences)).toEqual([]);
  });

  it('keeps an unscheduled tutorial and an entirely unscheduled option, including sections without meeting rows', () => {
    const parent = { ...course('1', 'COMP 1405', 'A', meeting('', '')), meeting_infos: [], section_type: 'Online Unscheduled Section' };
    const child = { ...parent, crn: '2', section: 'A1', type: 'Tutorial' };
    const selected: SelectedCourse = { ...select(parent), sections: { A: { parent, children: [child] } } };
    expect(generateSchedules([selected], preferences)).toEqual([[{ parent, child }]]);
    expect(generateSchedules([{ ...selected, disabled: new Set(['1']) }], preferences)).toEqual([]);
    const scheduledParent = { ...parent, section_type: 'Online Scheduled Section', meeting_infos: [meeting('Mon', '09:00 - 10:00')] };
    const overlapping = course('3', 'MATH 1000', 'A', meeting('Mon', '09:30 - 10:30'));
    expect(generateSchedules([{ ...selected, sections: { A: { parent: scheduledParent, children: [child] } } }, select(overlapping)], preferences)).toEqual([]);
  });

  it.each(['before', 'after', 'days off'])('excludes unscheduled metadata from %s preference scoring', (preference) => {
    const unscheduled = { ...course('1', 'COMP 1405', 'A', meeting('Mon Tue Wed Thu Fri', '08:00 - 21:00')), section_type: 'Online Unscheduled Section' };
    const scheduled = course('2', 'COMP 1405', 'B', meeting('Mon', '10:00 - 11:00'));
    const results = generateSchedules([select(unscheduled, scheduled)], { ...preferences, beforeEnabled: preference === 'before', afterEnabled: preference === 'after', prioritizeDaysOff: preference === 'days off' });
    expect(results.map(([{ parent }]) => parent.crn)).toEqual(['1', '2']);
  });
});
