import { isUnscheduled, scheduledMeetings, scheduleCourses, searchSchedules, timeRange } from '../scheduler';
import type { Course, ScheduleSection, SelectedCourse } from '../types';
import { days } from './schema';
import type { Plan } from './schema';

export interface SolveResult { schedules: ScheduleSection[][]; truncated: boolean; excluded: string[]; preferenceNotes: string[] }
const minutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
const instructorMatches = (course: Course, names: string[]) => names.some((name) => {
  const normalized = name.replace(/^(?:professor|prof\.?)\s+/i, '').trim();
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Boolean(normalized) && new RegExp(`\\b${escaped}\\b`, 'i').test(course.instructor);
});

export function rejection(course: Course, plan: Plan): string | undefined {
  if (!/^open\b/i.test(course.registration_status.trim())) return 'not confirmed open for registration';
  if (plan.excludeInstructors.length && (!course.instructor.trim() || /\b(TBA|staff|unassigned|unknown)\b/i.test(course.instructor))) return 'instructor unverified for a hard exclusion';
  if (instructorMatches(course, plan.excludeInstructors)) return 'excluded instructor';
  if (isUnscheduled(course)) return undefined;
  if (!course.meeting_infos.length) return 'missing meeting information';
  for (const meeting of course.meeting_infos) {
    const range = timeRange(meeting);
    const dates = meeting.meeting_date.split(/\s+to\s+/).map(Date.parse);
    const meetingDays = meeting.days.trim().split(/\s+/);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d\s+-\s+(?:[01]\d|2[0-3]):[0-5]\d$/.test(meeting.time.trim()) || !range || range[0] >= range[1] || dates.length !== 2 || !dates.every(Number.isFinite) || dates[0] > dates[1] || !meetingDays.every((day) => days.includes(day as typeof days[number]))) return 'unverifiable meeting time, date, or weekday';
    if (range[0] < 7 * 60 || range[1] > 22 * 60) return 'meeting outside the calendar display (07:00–22:00)';
    if (plan.daysOff.some((day) => meetingDays.includes(day))) return 'required day off';
    if ((plan.earliest && range[0] < minutes(plan.earliest)) || (plan.latest && range[1] > minutes(plan.latest))) return 'required time window';
  }
}

export function solvePlan(plan: Plan, courses: SelectedCourse[], previousCRNs: string[] = []): SolveResult {
  const excluded = new Set<string>();
  const selected = courses.map((course) => {
    const sections = Object.fromEntries(Object.entries(course.sections).filter(([, { parent, children }]) => {
      if (parent.also_register_in.trim() && !/^(none|n\/a)$/i.test(parent.also_register_in.trim()) && !children.length) {
        excluded.add(`${course.code}: required linked sections are missing`);
        return false;
      }
      if (/\band\b|&/i.test(parent.also_register_in)) {
        excluded.add(`${course.code}: multiple required linked components need manual verification`);
        return false;
      }
      return true;
    }));
    const disabled = new Set<string>();
    Object.values(sections).flatMap(({ parent, children }) => [parent, ...children]).forEach((section) => {
      const reason = rejection(section, plan);
      if (reason) { disabled.add(section.crn); excluded.add(`${course.code} ${section.section}: ${reason}`); }
    });
    return { ...course, sections, disabled };
  });
  const score = (schedule: ScheduleSection[]) => {
    const sections = schedule.flatMap(scheduleCourses);
    const meetings = sections.flatMap(scheduledMeetings);
    let penalty = sections.filter((course) => instructorMatches(course, plan.avoidInstructors)).length * 1000;
    for (const meeting of meetings) {
      const range = timeRange(meeting)!;
      for (const day of meeting.days.split(/\s+/)) {
        if (plan.preferredDaysOff.includes(day as typeof days[number])) penalty += 500;
        if (plan.lightDays.includes(day as typeof days[number])) penalty += range[1] - range[0];
      }
    }
    penalty += sections.filter((section) => !previousCRNs.includes(section.crn)).length / 100;
    return penalty;
  };
  const result = searchSchedules(selected, { beforeEnabled: Boolean(plan.preferAfter), before: plan.preferAfter || '09:00', afterEnabled: Boolean(plan.preferBefore), after: plan.preferBefore || '18:00', prioritizeDaysOff: true }, { maxNodes: 50000, maxResults: 10, score });
  const best = result.schedules[0]?.flatMap(scheduleCourses) || [];
  const preferenceNotes: string[] = [];
  if (best.some((course) => instructorMatches(course, plan.avoidInstructors))) preferenceNotes.push('An instructor you prefer to avoid remains in the best option found. Say “never [name]” to make that a hard exclusion.');
  if (best.flatMap(scheduledMeetings).some((meeting) => plan.preferredDaysOff.some((day) => meeting.days.split(/\s+/).includes(day)))) preferenceNotes.push('A preferred day off has classes. Say “[day] must be off” to require it.');
  if (best.flatMap(scheduledMeetings).some((meeting) => {
    const range = timeRange(meeting)!;
    return (plan.preferAfter && range[0] < minutes(plan.preferAfter)) || (plan.preferBefore && range[1] > minutes(plan.preferBefore));
  })) preferenceNotes.push('The best option found falls outside your preferred time window. Say “no classes before/after [time]” to make the bound mandatory.');
  if (best.some(isUnscheduled)) preferenceNotes.push('Online unscheduled courses are listed below the calendar; they still add workload.');
  return { ...result, excluded: [...excluded].slice(0, 12), preferenceNotes };
}
