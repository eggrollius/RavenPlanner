export const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
export type Day = typeof days[number];

export interface Plan {
  program: string;
  year: number | null;
  courseCount: number | null;
  courses: string[];
  keepCourses: string[];
  daysOff: Day[];
  preferredDaysOff: Day[];
  lightDays: Day[];
  avoidInstructors: string[];
  excludeInstructors: string[];
  earliest: string;
  latest: string;
  preferAfter: string;
  preferBefore: string;
  electiveQuery: string;
}

export const emptyPlan = (): Plan => ({ program: '', year: null, courseCount: null, courses: [], keepCourses: [], daysOff: [], preferredDaysOff: [], lightDays: [], avoidInstructors: [], excludeInstructors: [], earliest: '', latest: '', preferAfter: '', preferBefore: '', electiveQuery: '' });

const string = { type: 'string', maxLength: 100 };
const strings = { type: 'array', items: string, maxItems: 8 };
const dayList = { type: 'array', items: { type: 'string', enum: days }, maxItems: 5 };
export const patchProperties = {
  program: string, year: { type: 'integer', minimum: 1, maximum: 8 },
  courseCount: { type: 'integer', minimum: 1, maximum: 8 },
  addCourses: strings, removeCourses: strings, keepCourses: strings, releaseCourses: strings,
  daysOff: dayList, allowDays: dayList, preferredDaysOff: dayList, lightDays: dayList, releaseLightDays: dayList,
  avoidInstructors: strings, excludeInstructors: strings, allowInstructors: strings,
  earliest: string, latest: string, preferAfter: string, preferBefore: string, electiveQuery: string,
} as const;

export interface PlanPatch {
  program?: string; year?: number; courseCount?: number;
  addCourses?: string[]; removeCourses?: string[]; keepCourses?: string[]; releaseCourses?: string[];
  daysOff?: Day[]; allowDays?: Day[]; preferredDaysOff?: Day[]; lightDays?: Day[]; releaseLightDays?: Day[];
  avoidInstructors?: string[]; excludeInstructors?: string[]; allowInstructors?: string[];
  earliest?: string; latest?: string; preferAfter?: string; preferBefore?: string; electiveQuery?: string;
}

export type Decision = { tool: 'plan'; patch: PlanPatch } | { tool: 'search'; query: string } | { tool: 'clarify'; question: string };
export const decisionSchema = {
  type: 'object', properties: {
    tool: { type: 'string', enum: ['plan', 'search', 'clarify'] },
    patch: { type: 'object', properties: patchProperties, additionalProperties: false },
    query: string, question: { type: 'string', maxLength: 300 },
  }, required: ['tool'], additionalProperties: false,
};

const courseCode = /^[A-Z]{4} \d{4}[A-Z]?$/;
export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/^([A-Z]{4})\s*(\d{4}[A-Z]?)$/, '$1 $2');
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const fail = (): never => { throw new Error('The local model returned an invalid tool argument. Please rephrase your request.'); };

export function validatePatch(input: unknown): PlanPatch {
  if (!object(input)) return fail();
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(patchProperties, key)) return fail();
    if (['year', 'courseCount'].includes(key)) {
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 8) return fail();
      result[key] = value;
    } else if (['program', 'earliest', 'latest', 'preferAfter', 'preferBefore', 'electiveQuery'].includes(key)) {
      if (typeof value !== 'string' || value.length > 100) return fail();
      if (['earliest', 'latest', 'preferAfter', 'preferBefore'].includes(key) && value !== '' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return fail();
      result[key] = value.trim();
    } else {
      if (!Array.isArray(value) || value.length > 8 || !value.every((entry) => typeof entry === 'string' && entry.trim().length > 0 && entry.length <= 100)) return fail();
      const normalized = value.map((entry: string) => /Courses$/.test(key) ? normalizeCode(entry) : entry.trim());
      if (/Courses$/.test(key) && !normalized.every((entry) => courseCode.test(entry))) return fail();
      if (['daysOff', 'allowDays', 'preferredDaysOff', 'lightDays', 'releaseLightDays'].includes(key) && !normalized.every((entry) => days.includes(entry as Day))) return fail();
      result[key] = [...new Set(normalized)];
    }
  }
  return result as PlanPatch;
}

export function parseDecision(raw: string): Decision {
  const value: unknown = JSON.parse(raw);
  if (!object(value) || Object.keys(value).some((key) => !['tool', 'patch', 'query', 'question'].includes(key))) return fail();
  if (value.tool === 'plan') return { tool: 'plan', patch: validatePatch(value.patch) };
  if (value.tool === 'search' && typeof value.query === 'string' && value.query.trim() && value.query.length <= 100) return { tool: 'search', query: value.query.trim() };
  if (value.tool === 'clarify' && typeof value.question === 'string' && value.question.trim() && value.question.length <= 300) return { tool: 'clarify', question: value.question.trim() };
  return fail();
}

const merge = <T extends string>(current: T[], add: T[] = [], remove: T[] = []): T[] => [...new Set([...current, ...add])].filter((entry) => !remove.some((item) => item.toLowerCase() === entry.toLowerCase()));
export function applyPatch(plan: Plan, patch: PlanPatch): Plan {
  const next = { ...plan };
  for (const key of ['program', 'year', 'courseCount', 'earliest', 'latest', 'preferAfter', 'preferBefore', 'electiveQuery'] as const) {
    if (patch[key] !== undefined) Object.assign(next, { [key]: patch[key] });
  }
  next.keepCourses = merge(plan.keepCourses, patch.keepCourses, patch.releaseCourses);
  if (patch.removeCourses?.some((code) => next.keepCourses.includes(code))) throw new Error('That course is pinned. Ask me to release it before removing it.');
  next.courses = merge(plan.courses, patch.addCourses, patch.removeCourses);
  if (next.courses.length > 8) throw new Error('This prototype supports at most eight courses per term.');
  if (next.keepCourses.some((code) => !next.courses.includes(code))) throw new Error('Only a course in your plan can be pinned.');
  next.daysOff = merge(plan.daysOff, patch.daysOff, patch.allowDays);
  next.preferredDaysOff = merge(plan.preferredDaysOff, patch.preferredDaysOff, patch.allowDays);
  next.lightDays = merge(plan.lightDays, patch.lightDays, patch.releaseLightDays);
  next.avoidInstructors = merge(plan.avoidInstructors, patch.avoidInstructors, patch.allowInstructors);
  next.excludeInstructors = merge(plan.excludeInstructors, patch.excludeInstructors, patch.allowInstructors);
  if (next.avoidInstructors.length > 8 || next.excludeInstructors.length > 8) throw new Error('This prototype supports up to eight preferred and eight excluded instructors. Remove an old preference first.');
  if (next.earliest && next.latest && next.earliest >= next.latest) throw new Error('Your earliest class time must be before your latest finish.');
  return next;
}
