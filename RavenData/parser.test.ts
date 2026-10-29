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

describe('public timetable results', () => {
  it('parses the live 11-column format and meetings without public room assignments', () => {
    const html = readFileSync(new URL('./fixtures/public-results.html', import.meta.url), 'utf8');
    const log = vi.fn();
    expect(parseCourses(html, log)).toEqual([{
      registration_status: 'Registration Closed', crn: '30001', course_code: 'ACCS 5001',
      section: 'F', course_name: 'Critical Disability Studies', credits: 0.5,
      type: 'Seminar', instructor: 'Kelly Fritsch', section_type: 'IN-PERSON',
      meeting_infos: {
        meeting_date: 'Sep 09, 2026 to Dec 11, 2026', days: 'Tue', time: '08:35 - 11:25', building: '', room: '',
      },
    }]);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('Python parser field compatibility', () => {
  it.each(cases)('$name', ({ html, courses, payloads, logs }) => {
    const log = vi.fn();
    const parsed = parseCourses(html, log);
    // Section type is new; retain the recorded expectations for every legacy field.
    expect(parsed.map(({ section_type: _sectionType, ...course }) => course)).toEqual(courses);
    expect(parsed.map((course) => {
      const { section_type: _sectionType, ...payload } = coursePayload(course, { term: 'SUMMER', year: 2025 });
      return payload;
    })).toEqual(payloads);
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

const courseRow = cases[0].html.slice(cases[0].html.indexOf('<tr'), cases[0].html.indexOf('</tr>') + 5);
const separator = '<tr><td colspan="12">&nbsp;</td></tr>';
const infoRow = (label: string, singleCell = false) => `<tr>${singleCell ? '' : '<td>&nbsp;</td>'}<td colspan="11"><b>Section Information:</b>&nbsp;<a href="https://carleton.ca/registration/?p=361"> Section Type\n -</a>${label}. This course will be delivered as described. <a>Laptop requirement</a>.</td></tr>`;

describe('section delivery types', () => {
  it.each([
    'IN-PERSON SECTION (Campus presence)',
    'MIX OF IN-PERSON AND ONLINE SECTION (campus presence)',
    'Online Scheduled Section (Campus presence is not required)',
    'Online Scheduled Section with In-Person Assessments (Campus presence)',
    'ONLINE UNSCHEDULED SECTION (Campus presence is not required)',
    'Online Unscheduled Section with In-Person Assessments (Campus presence)',
    'In-person section (Optional campus presence)',
  ])('captures %s without the description or other links', (label) => {
    for (const singleCell of [true, false]) {
      const courses = parseCourses(courseRow + infoRow(label, singleCell) + separator);
      expect(courses).toHaveLength(1);
      expect(coursePayload(courses[0]).section_type).toBe(label);
    }
  });

  it('keeps delivery types separate for a lecture and its tutorial, even without meeting rows', () => {
    const tutorial = courseRow.replaceAll('35871', '35872').replace('>F</td>', '>F1</td>');
    const courses = parseCourses(courseRow + infoRow('Online Unscheduled Section') + separator + tutorial + infoRow('In-person section') + separator);
    expect(courses.map(({ section, section_type }) => ({ section, section_type }))).toEqual([
      { section: 'F', section_type: 'Online Unscheduled Section' },
      { section: 'F1', section_type: 'In-person section' },
    ]);
  });

  it('normalizes whitespace and leaves absent labels unknown on a rescrape', () => {
    expect(parseCourses(courseRow + infoRow(' ONLINE\n UNSCHEDULED\t SECTION ') + separator)[0].section_type).toBe('ONLINE UNSCHEDULED SECTION');
    expect(coursePayload(parseCourses(courseRow + separator)[0]).section_type).toBeNull();
    expect(coursePayload(parseCourses(courseRow + infoRow('') + separator)[0]).section_type).toBeNull();
  });
});
