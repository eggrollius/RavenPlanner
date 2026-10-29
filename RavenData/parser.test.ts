import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { coursePayload, parseCourses, parseSubjects } from './parser.js';

interface LegacyCase {
  name: string;
  html: string;
  courses: unknown[];
  payloads: unknown[];
  logs: string[];
}
const cases = JSON.parse(readFileSync(new URL('./fixtures/legacy-cases.json', import.meta.url), 'utf8')) as LegacyCase[];

describe('Python parser compatibility', () => {
  it.each(cases)('$name', ({ html, courses, payloads, logs }) => {
    const log = vi.fn();
    const parsed = parseCourses(html, log);
    expect(parsed).toEqual(courses);
    expect(parsed.map(coursePayload)).toEqual(payloads);
    expect(log.mock.calls.map(([message]) => message)).toEqual(logs);
  });

  it('keeps nonempty subject values in their original order, including duplicates', () => {
    expect(parseSubjects('<option>None</option><option value="">All</option><option value="COMP">Computing</option><option value="MATH">Math</option><option value="COMP">Again</option><option value="A&amp;B">Other</option>')).toEqual(['COMP', 'MATH', 'COMP', 'A&B']);
  });

  it('rejects malformed credits instead of silently sending zero', () => {
    for (const value of ['not a number', '', '0x10', '1__0']) {
      expect(() => parseCourses(cases[0].html.replace('>.5</td>', `>${value}</td>`))).toThrow('Invalid credits');
    }
  });

  it.each([
    ['.5', 0.5], ['+5e-1', 0.5], ['0_0.5', 0.5], ['NaN', NaN], ['+inf', Infinity], ['-Infinity', -Infinity],
  ])('parses credits %s with Python float semantics', (value, expected) => {
    expect(parseCourses(cases[0].html.replace('>.5</td>', `>${value}</td>`))[0].credits).toBe(expected);
  });
});
