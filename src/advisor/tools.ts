import { searchCourse } from '../api.js';
import type { Catalog, Course } from '../types.js';
import type { SolveResult } from './solver.js';
import type { AdvisorTools, CourseSummary } from './contracts.js';
export type { AdvisorTools, CourseSummary } from './contracts.js';

export function createTools(catalog: Catalog, request: typeof fetch = fetch, solver?: AdvisorTools['solve']): AdvisorTools {
  let directory: CourseSummary[] | undefined;
  return {
    async search(query, signal) {
      if (!directory) {
        const response = await request(`/api/courses?${new URLSearchParams({ term: catalog.term, year: String(catalog.year) })}`, { signal });
        if (!response.ok) throw new Error('Unable to search the term catalog. Try again.');
        const payload = await response.json() as { courses: Course[] };
        if (!Array.isArray(payload.courses)) throw new Error('The catalog response is invalid.');
        const grouped = new Map<string, CourseSummary>();
        for (const course of payload.courses) {
          if (course.term !== catalog.term || course.year !== catalog.year || course.section.length !== 1) continue;
          const entry = grouped.get(course.course_code) || { code: course.course_code, name: course.course_name, instructors: [] };
          entry.instructors = [...new Set([...entry.instructors, course.instructor])];
          grouped.set(entry.code, entry);
        }
        directory = [...grouped.values()];
      }
      const normalized = /geolog|\bearth\b|\berth\b/i.test(query) ? 'erth' : /computer science|\bcs\b/i.test(query) ? 'comp' : query.toLowerCase().replace(/\b(electives?|courses?|offered|available|this term)\b/g, '').trim();
      const tokens = normalized.split(/\s+/).filter(Boolean);
      if (!tokens.length) return [];
      return directory.filter((course) => tokens.every((token) => `${course.code} ${course.name} ${course.instructors.join(' ')}`.toLowerCase().includes(token))).slice(0, 20);
    },
    async sections(code, signal) {
      const sections = await searchCourse(code, catalog, signal, request);
      if (!Object.keys(sections).length || Object.values(sections).some(({ parent, children }) => [parent, ...children].some((course) => course.course_code !== code || course.term !== catalog.term || course.year !== catalog.year))) throw new Error(`${code}: no verified sections in this term.`);
      return { code, sections, disabled: new Set() };
    },
    solve: solver || function (plan, courses, previousCRNs, signal) {
      return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
        const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
        signal.addEventListener('abort', abort, { once: true });
        worker.onmessage = (event: MessageEvent<{ result?: SolveResult; error?: string }>) => {
          cleanup();
          if (event.data.result) resolve(event.data.result);
          else reject(new Error(event.data.error || 'Schedule search failed.'));
        };
        worker.onerror = () => { cleanup(); reject(new Error('The local scheduling worker failed. Please retry.')); };
        worker.postMessage([plan, courses, previousCRNs]);
      });
    },
  };
}
