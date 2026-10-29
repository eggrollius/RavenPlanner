import type { Course, MeetingInfo, Preferences, ScheduleSection, SelectedCourse } from './types';

// Only an explicit delivery label establishes that a section is unscheduled.
// Missing meeting times (including old catalog data) do not establish this.
export const isUnscheduled = (course: Course): boolean => /^online\s+unscheduled\b/i.test(course.section_type?.trim() || '');

export const scheduleCourses = (section: ScheduleSection): Course[] => section.child ? [section.parent, section.child] : [section.parent];
export const scheduledMeetings = (course: Course): MeetingInfo[] => isUnscheduled(course) ? [] : course.meeting_infos;

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

const meetings = (section: ScheduleSection) => scheduleCourses(section).flatMap(scheduledMeetings);
const compatible = (schedule: ScheduleSection[], candidate: ScheduleSection) => schedule.every((existing) => meetings(existing).every((a) => meetings(candidate).every((b) => !meetingsConflict(a, b))));

export interface ScheduleSearchOptions {
  maxNodes?: number;
  maxResults?: number;
  score?: (schedule: ScheduleSection[]) => number;
}

export function searchSchedules(selected: SelectedCourse[], preferences: Preferences, options: ScheduleSearchOptions = {}): { schedules: ScheduleSection[][]; truncated: boolean } {
  const choices = selected.map(({ sections, disabled }) => Object.values(sections).flatMap(({ parent, children }) => {
    if (disabled.has(parent.crn)) return [];
    const availableChildren = children.filter((child) => !disabled.has(child.crn) && scheduledMeetings(parent).every((a) => scheduledMeetings(child).every((b) => !meetingsConflict(a, b))));
    // Only lectures without linked tutorials or labs may stand alone.
    return children.length ? availableChildren.map((child) => ({ parent, child })) : [{ parent }];
  }));
  if (!choices.length || choices.some((choice) => !choice.length)) return { schedules: [], truncated: false };
  const score = (schedule: ScheduleSection[]) => {
    const all = schedule.flatMap(meetings); let score = 0;
    if (preferences.beforeEnabled) score += all.filter((m) => (timeRange(m)?.[0] ?? Infinity) < parseTime(preferences.before)).length * 10;
    if (preferences.afterEnabled) score += all.filter((m) => (timeRange(m)?.[1] ?? -Infinity) > parseTime(preferences.after)).length * 10;
    if (preferences.prioritizeDaysOff) score += new Set(all.flatMap((m) => m.days.split(/\s+/).filter(Boolean))).size;
    return score + (options.score?.(schedule) || 0);
  };
  const best: { schedule: ScheduleSection[]; score: number }[] = [];
  let nodes = 0;
  let truncated = false;
  const visit = (schedule: ScheduleSection[], depth: number) => {
    if (depth === choices.length) {
      best.push({ schedule, score: score(schedule) });
      if (options.maxResults && best.length > options.maxResults * 2) {
        best.sort((a, b) => a.score - b.score);
        best.length = options.maxResults;
      }
      return;
    }
    for (const candidate of choices[depth]) {
      if (nodes >= (options.maxNodes ?? Infinity)) { truncated = true; return; }
      nodes++;
      if (compatible(schedule, candidate)) visit([...schedule, candidate], depth + 1);
      if (truncated) return;
    }
  };
  visit([], 0);
  best.sort((a, b) => a.score - b.score);
  return { schedules: best.slice(0, options.maxResults).map(({ schedule }) => schedule), truncated };
}

export function generateSchedules(selected: SelectedCourse[], preferences: Preferences): ScheduleSection[][] {
  return searchSchedules(selected, preferences).schedules;
}
