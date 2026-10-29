import type { DecisionContext } from './model';
import { decisionSchema, patchProperties, days } from './schema';

// Small models copy examples surprisingly often. Limit the grammar to fields
// relevant to this turn and identifiers actually mentioned or retrieved.
// These hints narrow the model's choices; the controller still validates tools.
export function groundedSchema(context: DecisionContext) {
  const text = context.messages.at(-1)?.content || '';
  const previous = context.messages.at(-2);
  const answering = previous?.role === 'assistant' ? previous.content : '';
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const add = (...keys: (keyof typeof patchProperties)[]) => keys.forEach((key) => { properties[key] = patchProperties[key]; });
  const codes = [...new Set((text.toUpperCase().match(/\b[A-Z]{4}\s*\d{4}[A-Z]?\b/g) || []).map((code) => code.replace(/([A-Z]{4})\s*(\d)/, '$1 $2')))];
  const retrieved = context.observations.join(' ').match(/\b[A-Z]{4} \d{4}[A-Z]?\b/g) || [];
  const codeList = (values: string[]) => ({ type: 'array', items: { type: 'string', enum: [...new Set(values)] }, maxItems: 8 });
  if (codes.length || retrieved.length) properties.addCourses = codeList([...codes, ...retrieved]);
  if (/\b(remove|drop|replace|swap)\b/i.test(text) && context.plan.courses.length) properties.removeCourses = codeList(context.plan.courses);
  if (/\b(keep|preserve|retain|pin|lock)\b/i.test(text) && context.plan.courses.length) properties.keepCourses = codeList(context.plan.courses);
  if (/\b(release|unpin|unlock|remove|drop|replace|swap)\b/i.test(text) && context.plan.keepCourses.length) properties.releaseCourses = codeList(context.plan.keepCourses);
  if (codes.length || /\b(course count|course load|number of courses|(?:one|two|three|four|five|six|seven|eight|[1-8]) (?:courses?|classes?))\b/i.test(text)) add('courseCount');
  if (/\b(studying|program|major|CS|computer science|engineering|biology|psychology|mathematics)\b/i.test(text)) add('program');
  if (/\b(year|freshman|sophomore|junior|senior)\b/i.test(text)) add('year');
  const mentionedDays = days.filter((day, index) => new RegExp(`\\b(?:${day}|${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][index]})s?\\b`, 'i').test(text));
  if (mentionedDays.length) {
    const lighter = /\b(light|lighter|less|fewer|reduce)\b/i.test(text);
    const allow = /\b(allow|allowed|okay|fine|relax|remove|no longer|anymore)\b/i.test(text);
    if (lighter) add(/\b(stop|remove|undo|no longer)\b/i.test(text) ? 'releaseLightDays' : 'lightDays');
    if (allow) add('allowDays');
    if (/\b(off|free)\b/i.test(text) || (!allow && !lighter)) add(/\b(prefer|ideally)\b/i.test(text) ? 'preferredDaysOff' : 'daysOff');
    for (const key of ['daysOff', 'preferredDaysOff', 'lightDays', 'releaseLightDays', 'allowDays']) if (properties[key]) properties[key] = { type: 'array', items: { type: 'string', enum: mentionedDays }, maxItems: 5 };
  }
  if (/\b(before|after|start|finish|earl|late|morning|evening|noon)\w*\b|\d{1,2}:\d{2}/i.test(text)) add('earliest', 'latest', 'preferAfter', 'preferBefore');
  if (/\b(professor|prof|instructor|teach|taught|lecturer)\b/i.test(text) || [...context.plan.avoidInstructors, ...context.plan.excludeInstructors].some((name) => text.toLowerCase().includes(name.toLowerCase()))) {
    if (/\ballow\s+(?:professor|prof|instructor)|\b(?:professor|prof|instructor)\b.{0,30}\b(?:okay|fine|allowed)|\bno longer\b.{0,30}\b(?:professor|prof|instructor)\b/i.test(text)) add('allowInstructors');
    if (/\b(never|exclude|must not|do not|don't|dont|no classes with)\b/i.test(text)) add('excludeInstructors');
    else add('avoidInstructors');
    const names = [...text.matchAll(/\b(?:Professor|Prof\.?)\s+([A-Z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*){0,3})/g)].map((match) => match[1]);
    if (names.length) for (const key of ['allowInstructors', 'avoidInstructors', 'excludeInstructors']) if (properties[key]) {
      properties[key] = { type: 'array', items: { type: 'string', enum: names }, minItems: 1, maxItems: 8 };
      if (/\b(hate|dislike|avoid|never|exclude)\b/i.test(text)) required.push(key);
    }
  }
  if (/\b(geology|earth|elective|interest)\w*\b/i.test(text) && !/\b(keep|preserve|retain)\b/i.test(text)) add('electiveQuery');
  if (properties.electiveQuery && /\b(geology|geological)\b/i.test(text)) { properties.electiveQuery = { type: 'string', enum: ['geology', 'ERTH'] }; required.push('electiveQuery'); }
  // Literal identifiers/counts and unambiguous references are grounding facts,
  // not facts for the model to guess or regenerate from memory.
  const literal = (key: string, value: unknown) => { properties[key] = { const: value }; required.push(key); };
  if (/\b(CS|computer science)\b/i.test(text)) literal('program', 'CS');
  const year = text.match(/\b([1-8])(?:st|nd|rd|th)?[- ]year\b/i);
  const wordYear = text.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth)[- ]year\b/i);
  if (year || wordYear) literal('year', year ? Number(year[1]) : ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'].indexOf(wordYear![1].toLowerCase()) + 1);
  const count = text.match(/\b([1-8]|one|two|three|four|five|six|seven|eight)\s+(?:courses?|classes?)\b/i);
  if (count) literal('courseCount', /^\d$/.test(count[1]) ? Number(count[1]) : ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].indexOf(count[1].toLowerCase()) + 1);
  const bareCount = text.trim().replace(/[.!]$/, '').toLowerCase();
  if (/how many|course count/i.test(answering) && /^[1-8]$|^(one|two|three|four|five|six|seven|eight)$/.test(bareCount)) literal('courseCount', /^\d$/.test(bareCount) ? Number(bareCount) : ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].indexOf(bareCount) + 1);
  if (codes.length && (/\b(take|add|plan|schedule|eligible|enrol|register)\w*\b/i.test(text) || /eligible.*course codes|course codes.*eligible/i.test(answering)) && !/\b(remove|drop|replace|swap)\b/i.test(text)) literal('addCourses', codes);
  if (properties.keepCourses && /\b(geology|earth)\b/i.test(text)) {
    const earthCourses = context.plan.courses.filter((code) => code.startsWith('ERTH '));
    if (earthCourses.length === 1) literal('keepCourses', earthCourses);
  }
  if (properties.lightDays && mentionedDays.length === 1) literal('lightDays', mentionedDays);
  if (properties.daysOff && mentionedDays.length === 1 && /\b(off|free)\b/i.test(text)) literal('daysOff', mentionedDays);
  if (properties.allowDays && mentionedDays.length === 1 && /\b(allowed|allow|okay|fine)\b/i.test(text)) literal('allowDays', mentionedDays);
  const bound = text.match(/\b(no (?:classes|lectures) before|no (?:classes|lectures) after|prefer after|prefer before)\s+(\d{1,2}):([0-5]\d)\b/i);
  if (bound) {
    for (const key of ['earliest', 'latest', 'preferAfter', 'preferBefore']) delete properties[key];
    const key = bound[1].toLowerCase().startsWith('prefer') ? bound[1].toLowerCase().endsWith('after') ? 'preferAfter' : 'preferBefore' : bound[1].toLowerCase().endsWith('before') ? 'earliest' : 'latest';
    literal(key, `${bound[2].padStart(2, '0')}:${bound[3]}`);
  }
  const discovery = /\b(offered|available|offerings|search|find|recommend|show me|what .*courses|which .*courses|what .*electives)\b/i.test(text);
  const toolChoices = discovery && !context.observations.length ? ['search'] : Object.keys(properties).length ? ['plan'] : ['plan', 'search', 'clarify'];
  const schema = {
    ...decisionSchema,
    required: toolChoices.length === 1 ? ['tool', toolChoices[0] === 'plan' ? 'patch' : 'query'] : ['tool'],
    properties: {
      ...decisionSchema.properties,
      tool: { type: 'string', enum: toolChoices },
      patch: { type: 'object', properties: Object.keys(properties).length ? properties : patchProperties, required, additionalProperties: false },
    },
  };
  const descriptions: Record<string, string> = {
    program: 'study program', year: 'study year', courseCount: 'desired course count', addCourses: 'add these codes', removeCourses: 'remove these codes', keepCourses: 'pin existing course, geology means ERTH', releaseCourses: 'unpin course',
    daysOff: 'required day off', preferredDaysOff: 'prefer a day off', lightDays: 'make day lighter', releaseLightDays: 'remove lighter-day preference', allowDays: 'allow this day again',
    avoidInstructors: 'dislike professor, names without title', excludeInstructors: 'never schedule professor', allowInstructors: 'allow professor again',
    earliest: 'hard start bound', latest: 'hard finish bound', preferAfter: 'soft start preference', preferBefore: 'soft finish preference', electiveQuery: 'elective subject interest, e.g. geology',
  };
  return { schema, fields: Object.keys(properties).map((key) => `${key}: ${descriptions[key]}`).join('; ') || Object.keys(patchProperties).join(', ') };
}
