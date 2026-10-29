import { describe, expect, it, vi } from 'vitest';
import { runTurn } from './agent';
import type { AdvisorSession } from './agent';
import type { AdvisorModel } from './model';
import { applyPatch, emptyPlan, parseDecision, validatePatch } from './schema';
import type { Decision } from './schema';
import { rejection, solvePlan } from './solver';
import type { AdvisorTools } from './tools';
import type { Course, SelectedCourse } from '../types';
import { meetingsConflict, scheduleCourses, scheduledMeetings, searchSchedules } from '../scheduler';
import { groundedSchema } from './grounding';

const meeting = (days = 'Mon', time = '10:00 - 11:00') => ({ days, time, meeting_date: 'Sep 08, 2026 to Dec 08, 2026', building: 'HP', room: '1' });
const section = (code: string, crn: string, name: string, days = 'Mon', time = '10:00 - 11:00'): Course => ({ id: Number(crn), course_code: code, crn, section: name, course_name: code, instructor: 'Alex Morgan', registration_status: 'Open', credits: 0.5, type: 'Lecture', also_register_in: '', term: 'FALL', year: 2026, meeting_infos: [meeting(days, time)] });
const selections = (): SelectedCourse[] => [
  { code: 'COMP 1405', disabled: new Set(), sections: {
    A: { parent: section('COMP 1405', '1', 'A'), children: [section('COMP 1405', '2', 'A1', 'Fri'), section('COMP 1405', '3', 'A2', 'Thu')] },
    B: { parent: section('COMP 1405', '4', 'B', 'Tue'), children: [section('COMP 1405', '5', 'B1', 'Wed')] },
  } },
  { code: 'ERTH 1006', disabled: new Set(), sections: {
    A: { parent: section('ERTH 1006', '6', 'A', 'Tue', '13:00 - 16:00'), children: [] },
    B: { parent: section('ERTH 1006', '7', 'B', 'Wed', '12:00 - 13:00'), children: [] },
  } },
];
const initialSession = (): AdvisorSession => ({ plan: emptyPlan(), messages: [], previousCRNs: [] });
const signal = () => new AbortController().signal;
const model = (...decisions: Decision[]): AdvisorModel => ({ decide: vi.fn(async () => decisions.shift()!) });
const tools = (): AdvisorTools => ({
  search: vi.fn(async () => [{ code: 'ERTH 1006', name: 'Earth Science (Demo)', instructors: ['Alex Morgan'] }]),
  sections: vi.fn(async (code) => { const found = selections().find((course) => course.code === code); if (!found) throw new Error('Course unavailable'); return found; }),
  solve: vi.fn(async (plan, courses, previousCRNs) => solvePlan(plan, courses, previousCRNs)),
});

describe('validated planning state', () => {
  it('grounds grammar identifiers and relevant fields without example leakage', () => {
    const context = { plan: emptyPlan(), messages: [{ role: 'user' as const, content: "I'm a 4th-year CS student. Fridays off, geology electives, hate Professor X." }], observations: [] };
    const grammar = groundedSchema(context).schema;
    expect(grammar.properties.tool.enum).toEqual(['plan']);
    expect(grammar.properties.patch.properties).toMatchObject({ year: { const: 4 }, program: { const: 'CS' }, daysOff: { const: ['Fri'] } });
    expect(grammar.properties.patch.properties).not.toHaveProperty('addCourses');
    expect(grammar.properties.patch.properties).not.toHaveProperty('earliest');
    expect(groundedSchema({ ...context, messages: [{ role: 'user', content: 'Take COMP 1405 and MATH 1007, two courses.' }] }).schema.properties.patch.properties).not.toHaveProperty('program');
    const next = groundedSchema({ ...context, plan: { ...emptyPlan(), courses: ['COMP 1405', 'ERTH 1006'] }, messages: [{ role: 'user', content: 'Make Tuesdays lighter but keep my geology elective.' }] }).schema;
    expect(next.properties.patch.properties).toMatchObject({ keepCourses: { const: ['ERTH 1006'] }, lightDays: { const: ['Tue'] } });
    const discovery = groundedSchema({ ...context, messages: [{ role: 'user', content: 'What geology electives are offered?' }] }).schema;
    expect(discovery.properties.tool.enum).toEqual(['search']);
    expect(discovery.required).toEqual(['tool', 'query']);
    const answer = groundedSchema({ ...context, messages: [{ role: 'assistant', content: 'How many courses do you want?' }, { role: 'user', content: 'Three' }] }).schema;
    expect(answer.properties.patch.properties).toMatchObject({ courseCount: { const: 3 } });
  });
  it.each([
    { addCourses: ['COMP 9999; DROP TABLE courses'] }, { courseCount: 100 }, { year: -1 }, { daysOff: ['Friday'] }, { earliest: '25:00' }, { latest: '09:99' }, { unknownTool: 'anything' }, { addCourses: 'COMP 1405' },
  ])('rejects invalid arguments: %j', (patch) => expect(() => validatePatch(patch)).toThrow());

  it('normalizes course codes and rejects unsupported tools', () => {
    expect(validatePatch({ addCourses: ['comp1405'] })).toEqual({ addCourses: ['COMP 1405'] });
    expect(() => parseDecision('{"tool":"fetch","url":"https://example.com"}')).toThrow();
  });

  it('merges changes, preserves constraints, and protects pinned courses', () => {
    const plan = applyPatch(emptyPlan(), { addCourses: ['COMP 1405', 'ERTH 1006'], keepCourses: ['ERTH 1006'], daysOff: ['Fri'], avoidInstructors: ['Smith'] });
    const next = applyPatch(plan, { lightDays: ['Tue'] });
    expect(next).toMatchObject({ courses: plan.courses, daysOff: ['Fri'], keepCourses: ['ERTH 1006'], avoidInstructors: ['Smith'], lightDays: ['Tue'] });
    expect(() => applyPatch(next, { removeCourses: ['ERTH 1006'] })).toThrow('pinned');
    expect(applyPatch(next, { releaseCourses: ['ERTH 1006'], removeCourses: ['ERTH 1006'], allowDays: ['Fri'] })).toMatchObject({ courses: ['COMP 1405'], daysOff: [], keepCourses: [] });
    expect(() => applyPatch(next, { earliest: '18:00', latest: '09:00' })).toThrow('earliest');
  });
});

describe('grounded scheduling', () => {
  it('enforces a Friday off including linked tutorials, keeps all courses, and lightens Tuesdays', () => {
    const plan = applyPatch(emptyPlan(), { addCourses: ['COMP 1405', 'ERTH 1006'], daysOff: ['Fri'], lightDays: ['Tue'], keepCourses: ['ERTH 1006'] });
    const result = solvePlan(plan, selections());
    expect(result.schedules.length).toBeGreaterThan(0);
    expect(result.schedules[0][1].parent.section).toBe('B');
    for (const schedule of result.schedules) {
      expect(schedule.map(({ parent }) => parent.course_code)).toEqual(plan.courses);
      expect(schedule[0].child).toBeDefined();
      const meetings = schedule.flatMap(scheduleCourses).flatMap(scheduledMeetings);
      expect(meetings.every((meeting) => !meeting.days.includes('Fri'))).toBe(true);
      for (let i = 0; i < meetings.length; i++) for (const other of meetings.slice(i + 1)) expect(meetingsConflict(meetings[i], other)).toBe(false);
    }
  });

  it('does not relax impossible requirements or drop required children', () => {
    const selected = selections().slice(0, 1);
    const result = solvePlan({ ...emptyPlan(), daysOff: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }, selected);
    expect(result.schedules).toEqual([]);
    expect(result.excluded.some((reason) => reason.includes('required day off'))).toBe(true);
  });

  it('rejects closed, missing, malformed and out-of-range meeting data; permits explicit unscheduled delivery', () => {
    const course = section('COMP 1405', '1', 'A');
    expect(rejection({ ...course, registration_status: 'Closed' }, emptyPlan())).toMatch(/registration/);
    expect(rejection({ ...course, instructor: 'TBA' }, { ...emptyPlan(), excludeInstructors: ['X'] })).toMatch(/instructor unverified/);
    expect(rejection({ ...course, meeting_infos: [] }, emptyPlan())).toMatch(/missing/);
    for (const info of [meeting('TBA'), meeting('Mon', '09:99 - 11:00'), { ...meeting(), meeting_date: 'TBA' }, meeting('Mon', '06:00 - 08:00')]) expect(rejection({ ...course, meeting_infos: [info] }, emptyPlan())).toBeDefined();
    expect(rejection({ ...course, section_type: 'Online Unscheduled', meeting_infos: [] }, emptyPlan())).toBeUndefined();
  });

  it('distinguishes preferred and excluded instructors without matching fragments of names', () => {
    const selected = selections().slice(0, 1);
    expect(solvePlan({ ...emptyPlan(), avoidInstructors: ['Alex Morgan'] }, selected).preferenceNotes.join(' ')).toMatch(/instructor/);
    expect(solvePlan({ ...emptyPlan(), excludeInstructors: ['Professor Alex Morgan'] }, selected).schedules).toEqual([]);
    expect(solvePlan({ ...emptyPlan(), excludeInstructors: ['X'] }, selected).schedules.length).toBeGreaterThan(0);
  });

  it('reports a capped search and rejects parent/tutorial self-conflicts', () => {
    const selected = selections();
    const prefs = { beforeEnabled: false, before: '09:00', afterEnabled: false, after: '18:00', prioritizeDaysOff: true };
    expect(searchSchedules(selected, prefs, { maxNodes: 1, maxResults: 1 }).truncated).toBe(true);
    selected[0].sections = { A: { parent: section('COMP 1405', '1', 'A'), children: [section('COMP 1405', '2', 'A1')] } };
    expect(solvePlan(emptyPlan(), selected).schedules).toEqual([]);
  });
});

describe('multi-turn tool orchestration', () => {
  it('does not publish invented academic assertions in model clarification text', async () => {
    const result = await runTurn(initialSession(), 'What should I take?', model({ tool: 'clarify', question: 'COMP 9999 is required to graduate. Have you taken it?' }), tools(), signal(), () => {});
    expect(result.reply).not.toContain('COMP 9999');
    expect(result.reply).toContain('does not contain prerequisites');
  });
  it('clarifies profile, generates a schedule and refines it without losing the geology elective', async () => {
    const api = tools();
    const first = await runTurn(initialSession(), 'Fourth year CS, Fridays off, geology electives. Avoid Professor X.', model({ tool: 'plan', patch: { year: 4, program: 'CS', daysOff: ['Fri'], electiveQuery: 'geology', avoidInstructors: ['X'] } }), api, signal(), () => {});
    expect(first.reply).toContain('eligible');
    expect(api.search).toHaveBeenCalledWith('geology', expect.any(AbortSignal));
    expect(api.solve).not.toHaveBeenCalled();
    const secondSession = { ...initialSession(), plan: first.plan };
    const second = await runTurn(secondSession, 'Take COMP 1405 and ERTH 1006, two courses.', model({ tool: 'plan', patch: { addCourses: ['COMP 1405', 'ERTH 1006'], courseCount: 2 } }), api, signal(), () => {});
    expect(second.current).toBe(true);
    const third = await runTurn({ ...secondSession, plan: second.plan }, 'Make Tuesdays lighter, but keep my geology elective.', model({ tool: 'plan', patch: { lightDays: ['Tue'], keepCourses: ['ERTH 1006'] } }), api, signal(), () => {});
    expect(third.plan).toMatchObject({ year: 4, daysOff: ['Fri'], avoidInstructors: ['X'], keepCourses: ['ERTH 1006'], courses: ['COMP 1405', 'ERTH 1006'] });
    expect(third.schedules?.[0][1].parent.section).toBe('B');
    expect(third.trace).toContain('generate_schedule: enforce hard constraints, rank preferences');
  });

  it('feeds search observations back to the model before selecting a retrieved course', async () => {
    const llm = model({ tool: 'search', query: 'geology' }, { tool: 'plan', patch: { addCourses: ['ERTH 1006'], courseCount: 1 } });
    const result = await runTurn(initialSession(), 'Find a geology elective and plan it.', llm, tools(), signal(), () => {});
    expect(result.current).toBe(true);
    expect(llm.decide).toHaveBeenLastCalledWith(expect.objectContaining({ observations: [expect.stringContaining('ERTH 1006')] }), expect.any(AbortSignal));
  });

  it('rejects invented courses, handles unavailability, and bounds tool loops', async () => {
    await expect(runTurn(initialSession(), 'Plan my schedule.', model({ tool: 'plan', patch: { addCourses: ['COMP 9999'] } }), tools(), signal(), () => {})).rejects.toThrow('did not mention');
    const result = await runTurn(initialSession(), 'Take COMP 9999.', model({ tool: 'plan', patch: { addCourses: ['COMP 9999'] } }), tools(), signal(), () => {});
    expect(result.current).toBe(false);
    expect(result.reply).toContain('could not be verified');
    expect(result.plan.courses).toEqual(['COMP 9999']);
    const search = { tool: 'search' as const, query: 'geology' };
    const loop = await runTurn(initialSession(), 'Find geology.', model(search, search, search, search), tools(), signal(), () => {});
    expect(loop.reply).toContain('tool limit');
  });

  it('cancels before invoking tools', async () => {
    const controller = new AbortController(); controller.abort();
    const llm = model({ tool: 'plan', patch: {} });
    await expect(runTurn(initialSession(), 'Plan my schedule.', llm, tools(), controller.signal, () => {})).rejects.toThrow();
    expect(llm.decide).not.toHaveBeenCalled();
  });
});
