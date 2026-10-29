import { load } from 'cheerio';
import type { MeetingInput } from '../server/types.js';

export interface ScrapedCourse {
  registration_status?: string;
  crn?: string;
  course_code?: string;
  section?: string;
  course_name?: string;
  credits?: number;
  type?: string;
  instructor?: string;
  meeting_infos?: MeetingInput;
  also_register_in?: string;
  term?: string;
  year?: number;
}

// html.parser does not insert or discard table rows in an HTML fragment.
const parseHtml = (html: string) => load(html, { xml: { xmlMode: false, decodeEntities: true } });

function parseCredits(value: string) {
  // Match Python float(), including exponents and digit separators, without
  // accepting JavaScript-only inputs such as hexadecimal literals.
  if (!/^[+-]?(?:(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:e[+-]?\d(?:_?\d)*)?|inf(?:inity)?|nan)$/i.test(value)) {
    throw new Error(`Invalid credits: ${value}`);
  }
  const number = value.replaceAll('_', '');
  if (/^[+-]?inf(?:inity)?$/i.test(number)) return number.startsWith('-') ? -Infinity : Infinity;
  return Number(number);
}

export function parseSubjects(html: string): string[] {
  const $ = parseHtml(html);
  // Cheerio's attr('value') supplies an option-text fallback; BeautifulSoup does not.
  return $('option').toArray().map((option) => option.attribs.value).filter((value): value is string => Boolean(value));
}

export function parseCourses(html: string, log: (message: string) => void = console.log): ScrapedCourse[] {
  const $ = parseHtml(html);
  const courses: ScrapedCourse[] = [];
  let course: ScrapedCourse = {};

  // BeautifulSoup get_text(strip=True) strips each text node before joining.
  const text = (element: ReturnType<typeof $>, strip = false): string => element.contents().toArray().map((node): string => {
    if (node.type === 'text') return strip ? node.data.trim() : node.data;
    if (node.type === 'tag') return text($(node), strip);
    return '';
  }).join('');
  const required = (element: ReturnType<typeof $>) => {
    if (!element.length) throw new Error('Missing course column or link');
    return text(element, true);
  };
  const singleString = (element: ReturnType<typeof $>): string | undefined => {
    const children = element.contents().toArray();
    if (children.length !== 1) return undefined;
    const child = children[0];
    if (child.type === 'text') return child.data;
    if (child.type === 'tag') return singleString($(child));
  };
  const between = (value: string, start: string, end?: string) => {
    const part = value.split(start)[1];
    if (part === undefined) throw new Error(`Missing ${start} in meeting information`);
    return (end ? part.split(end)[0] : part).trim();
  };

  for (const row of $('tr').toArray()) {
    const cells = $(row).find('td');
    if (cells.length <= 1) {
      courses.push(course);
      course = {};
    } else if (cells.length > 2) {
      course.registration_status = required(cells.eq(1));
      course.crn = required(cells.eq(2).find('a').first());
      course.course_code = required(cells.eq(3).find('a').first());
      course.section = required(cells.eq(4));
      course.course_name = required(cells.eq(5).find('a').first());
      course.credits = parseCredits(required(cells.eq(6)));
      course.type = required(cells.eq(7));
      course.instructor = required(cells.eq(11));
    } else {
      const details = cells.eq(1);
      const content = text(details);
      if (content.includes('Meeting Date:')) {
        // The legacy scraper replaces earlier meetings with the last meeting row.
        course.meeting_infos = {
          meeting_date: between(content, 'Meeting Date:', 'Days:'),
          days: between(content, 'Days:', 'Time:'),
          time: between(content, 'Time:', 'Building:'),
          building: between(content, 'Building:', 'Room:'),
          room: between(content, 'Room:'),
        };
      } else if (content.includes('Also Register in:')) {
        const anchor = details.find('a').toArray().find((node) => singleString($(node)) === 'Also Register in:');
        if (anchor) {
          const parts = content.split('Also Register in:')[1].trim().split(' ');
          const code = parts.slice(0, 2).join(' ');
          course.also_register_in = parts.slice(2).filter((section) => section !== 'or').map((section) => `${code} ${section}`).join(',');
        }
      } else if (!content.includes('Section Information:')) {
        log('Cannot Classify Row');
      }
    }
  }
  // A course is emitted only at a separator, just as in the Python scraper.
  return courses;
}

export function coursePayload(course: ScrapedCourse) {
  return {
    registration_status: '', crn: '', course_code: '', section: '', course_name: '',
    credits: '' as number | string, type: '', instructor: '', also_register_in: '',
    term: 'SUMMER', year: 2025,
    ...course,
  };
}
