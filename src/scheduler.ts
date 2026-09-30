import type { Course, MeetingInfo, Preferences, ScheduleSection, SelectedCourse } from './types';

const parseTime = (value: string) => {
  const [hours, minutes] = value.trim().split(':').map(Number);
  return hours * 60 + minutes;
};

export function timeRange(meeting: MeetingInfo): [number, number] | null {
  const parts = meeting.time.split(/\s+-\s+/);
  if (parts.length !== 2) return null;
  const range: [number, number] = [parseTime(parts[0]), parseTime(parts[1])];
  return range.every(Number.isFinite) ? range : null;
}

const dateRange = (meeting: MeetingInfo): [number, number] | null => {
  const [start, end] = meeting.meeting_date.split(/\s+to\s+/).map((date) => Date.parse(date));
  return Number.isFinite(start) && Number.isFinite(end) ? [start, end] : null;
};

export function meetingsConflict(left: MeetingInfo, right: MeetingInfo): boolean {
  const leftTime = timeRange(left); const rightTime = timeRange(right);
  const leftDate = dateRange(left); const rightDate = dateRange(right);
  if (!leftTime || !rightTime || !leftDate || !rightDate) return false;
  const sameDay = left.days.split(/\s+/).some((day) => right.days.split(/\s+/).includes(day));
  return sameDay && leftDate[0] <= rightDate[1] && rightDate[0] <= leftDate[1] && leftTime[0] < rightTime[1] && rightTime[0] < leftTime[1];
}

const meetings = (section: ScheduleSection) => [...section.parent.meeting_infos, ...(section.child?.meeting_infos || [])];
const compatible = (schedule: ScheduleSection[], candidate: ScheduleSection) => schedule.every((existing) => meetings(existing).every((a) => meetings(candidate).every((b) => !meetingsConflict(a, b))));

export function generateSchedules(selected: SelectedCourse[], preferences: Preferences): ScheduleSection[][] {
  const choices = selected.map(({ sections, disabled }) => Object.values(sections).flatMap(({ parent, children }) => {
    if (disabled.has(parent.crn)) return [];
    const availableChildren = children.filter((child) => !disabled.has(child.crn));
    return availableChildren.length ? availableChildren.map((child) => ({ parent, child })) : [{ parent }];
  }));
  if (!choices.length || choices.some((choice) => !choice.length)) return [];
  let schedules: ScheduleSection[][] = [[]];
  for (const courseChoices of choices) schedules = schedules.flatMap((schedule) => courseChoices.filter((candidate) => compatible(schedule, candidate)).map((candidate) => [...schedule, candidate]));
  const score = (schedule: ScheduleSection[]) => {
    const all = schedule.flatMap(meetings); let score = 0;
    if (preferences.beforeEnabled) score += all.filter((m) => (timeRange(m)?.[0] ?? Infinity) < parseTime(preferences.before)).length * 10;
    if (preferences.afterEnabled) score += all.filter((m) => (timeRange(m)?.[1] ?? -Infinity) > parseTime(preferences.after)).length * 10;
    if (preferences.prioritizeDaysOff) score += new Set(all.flatMap((m) => m.days.split(/\s+/).filter(Boolean))).size;
    return score;
  };
  return schedules.sort((a, b) => score(a) - score(b));
}
