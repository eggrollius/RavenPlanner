import type { ScheduleSection } from '../types';
import type { AdvisorModel, Message } from './model';
import { applyPatch } from './schema';
import type { Plan } from './schema';
import type { AdvisorTools, CourseSummary } from './tools';

export interface AdvisorSession { plan: Plan; messages: Message[]; previousCRNs: string[] }
export interface TurnResult { plan: Plan; reply: string; schedules?: ScheduleSection[][]; trace: string[]; current: boolean }

const suggestions = (courses: CourseSummary[]) => courses.length ? courses.slice(0, 8).map((course) => `${course.code} — ${course.name}`).join('\n') : 'No matching courses were found in this term.';

export async function propose(plan: Plan, tools: AdvisorTools, previousCRNs: string[], signal: AbortSignal, trace: string[]): Promise<Omit<TurnResult, 'plan' | 'trace'>> {
  if (!plan.courses.length || !plan.courseCount || plan.courses.length !== plan.courseCount) {
    let reply = !plan.courses.length
      ? 'Which course codes are you eligible to take, and how many courses do you want this term? I can search for electives, but this catalog does not contain prerequisites or degree requirements.'
      : `Your plan has ${plan.courses.length} course(s)${plan.courseCount ? ` and a target of ${plan.courseCount}` : ''}. Tell me the remaining eligible course codes, or the total course count you want. Your saved constraints will stay in place.`;
    if (plan.electiveQuery) {
      trace.push(`search_catalog: ${plan.electiveQuery}`);
      const matches = await tools.search(plan.electiveQuery, signal);
      reply += `\n\nElective matches in this term (eligibility unverified):\n${suggestions(matches)}\nTell me which, if any, you are eligible to add.`;
    }
    return { reply, current: false };
  }
  const courses = [];
  for (const code of plan.courses) {
    trace.push(`get_sections: ${code}`);
    try { courses.push(await tools.sections(code, signal)); }
    catch (error) {
      signal.throwIfAborted();
      return { reply: `${code} could not be verified: ${error instanceof Error ? error.message : 'catalog lookup failed'}. No courses or constraints have been dropped. Check the code or ask me to remove it.`, current: false };
    }
  }
  trace.push('generate_schedule: enforce hard constraints, rank preferences');
  const result = await tools.solve(plan, courses, previousCRNs, signal);
  signal.throwIfAborted();
  if (!result.schedules.length) return {
    reply: `${result.truncated ? 'The bounded search did not find a valid timetable; it has not proved that none exists.' : 'No timetable satisfies all the saved hard constraints with the verified sections.'} No requirement was relaxed. You can allow a day, change the time window, allow an instructor, or remove a course.\n${result.excluded.join('\n')}`,
    current: false,
  };
  const summary = result.schedules[0].map(({ parent, child }) => `${parent.course_code}: ${parent.section}${child ? ` + ${child.section}` : ''} · ${parent.instructor}`).join('\n');
  const notes = [...result.preferenceNotes];
  if (plan.lightDays.length) notes.push(`Ranked by fewer scheduled minutes on ${plan.lightDays.join(', ')}. Other saved requirements are preserved.`);
  if (plan.daysOff.length) notes.push(`Required days off: ${plan.daysOff.join(', ')}.`);
  if (plan.keepCourses.length) notes.push(`Kept: ${plan.keepCourses.join(', ')}.`);
  if (result.truncated) notes.push('Search reached 50,000 candidates. These are the best options found, not a guarantee of the global optimum.');
  const credits = result.schedules[0].reduce((sum, { parent }) => sum + Number(parent.credits || 0), 0);
  return {
    reply: `Your ${plan.courses.length}-course timetable is ready (${credits} catalog credits).\n${summary}\n\n${notes.join('\n')}\nTime conflicts and linked sections were checked against this term’s catalog. Prerequisites, degree progress and registration eligibility still need confirmation with the university.`,
    schedules: result.schedules, current: true,
  };
}

export async function runTurn(session: AdvisorSession, text: string, model: AdvisorModel, tools: AdvisorTools, signal: AbortSignal, progress: (text: string) => void): Promise<TurnResult> {
  if (!text.trim() || text.length > 1500) throw new Error('Please keep each message between 1 and 1,500 characters.');
  const messages: Message[] = [...session.messages, { role: 'user', content: text }];
  const observations: string[] = [];
  const trace: string[] = [];
  const observedCodes = new Set<string>();
  let lastMatches: CourseSummary[] | undefined;
  let currentSchedule = '';
  if (session.previousCRNs.length) {
    progress('Reading your current timetable…');
    for (const code of session.plan.courses) {
      const course = await tools.sections(code, signal);
      currentSchedule += Object.values(course.sections).flatMap(({ parent, children }) => [parent, ...children]).filter(({ crn }) => session.previousCRNs.includes(crn)).map((section) => `${code} ${section.section} [${section.crn}], ${section.instructor}: ${section.meeting_infos.map((meeting) => `${meeting.days} ${meeting.time}`).join('; ')}`).join('\n');
    }
  }
  for (let step = 0; step < 4; step++) {
    signal.throwIfAborted();
    progress(step ? 'Reading tool results locally…' : 'Understanding your request locally…');
    let decision;
    try { decision = await model.decide({ plan: session.plan, messages, observations, currentSchedule }, signal); }
    catch (error) {
      signal.throwIfAborted();
      if (step >= 1) throw error;
      observations.push('Invalid response. Return one valid JSON tool call with validated arguments.');
      continue;
    }
    trace.push(`local_model: ${decision.tool}`);
    if (decision.tool === 'search') {
      progress('Searching this term’s course catalog…');
      const matches = await tools.search(decision.query, signal);
      lastMatches = matches;
      matches.forEach(({ code }) => observedCodes.add(code));
      observations.push(`search(${JSON.stringify(decision.query)}): ${JSON.stringify(matches)}`);
      trace.push(`search_catalog: ${decision.query} (${matches.length} matches)`);
      continue;
    }
    if (decision.tool === 'clarify') return {
      plan: session.plan,
      // Model prose is not a source of academic facts, even inside a question.
      reply: lastMatches
        ? `Matches in this term (eligibility unverified):\n${suggestions(lastMatches)}\n\nWhich eligible course codes would you like to add, and how many courses do you want in total?`
        : 'Please specify the eligible course codes or the exact change you want to make: days off, lighter days, class times, or instructors. I can verify catalog sections and time conflicts; this catalog does not contain prerequisites or degree requirements.',
      trace, current: false,
    };
    // Only a user-mentioned or retrieved code can enter the plan. Model recall is not a source.
    const userText = messages.filter(({ role }) => role === 'user').map(({ content }) => content.toUpperCase().replace(/([A-Z]{4})\s*(\d{4})/g, '$1 $2')).join(' ');
    if (decision.patch.addCourses?.some((code) => !userText.includes(code) && !observedCodes.has(code) && !session.plan.courses.includes(code))) throw new Error('The model tried to add a course that you did not mention and the catalog tools did not retrieve. Ask me to search for it first.');
    const plan = applyPatch(session.plan, decision.patch);
    if (!plan.courseCount && decision.patch.addCourses?.length) plan.courseCount = plan.courses.length;
    progress('Checking sections and building your timetable…');
    const proposal = await propose(plan, tools, session.previousCRNs, signal, trace);
    signal.throwIfAborted();
    return { plan, trace, ...proposal };
  }
  return { plan: session.plan, reply: `I reached the local tool limit. Please give the course codes you want, or ask one narrower question.\n${observations.length ? observations.filter((entry) => entry.startsWith('search(')).join('\n').slice(0, 1500) : ''}`, trace, current: false };
}
