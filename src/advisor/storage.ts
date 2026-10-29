import type { Catalog } from '../types';
import type { AdvisorSession } from './agent';
import { applyPatch, emptyPlan, validatePatch } from './schema';

const key = (catalog: Catalog) => `raven-advisor-v1:${catalog.term}:${catalog.year}`;
export const freshSession = (): AdvisorSession => ({ plan: emptyPlan(), messages: [], previousCRNs: [] });

export function readSession(catalog: Catalog): AdvisorSession {
  try {
    const raw = localStorage.getItem(key(catalog));
    if (!raw) return freshSession();
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || !saved.plan || !Array.isArray(saved.messages) || !Array.isArray(saved.previousCRNs)) return freshSession();
    const { courses, ...plan } = saved.plan;
    if (!Array.isArray(courses)) return freshSession();
    if (plan.year === null) delete plan.year;
    if (plan.courseCount === null) delete plan.courseCount;
    const restored = applyPatch(emptyPlan(), validatePatch({ ...plan, addCourses: courses }));
    if (!saved.messages.every((message: { role: string; content: string }) => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string' && message.content.length <= 6000)) return freshSession();
    if (!saved.previousCRNs.every((crn: unknown) => typeof crn === 'string' && /^\d{1,20}$/.test(crn))) return freshSession();
    return { plan: restored, messages: saved.messages.slice(-20), previousCRNs: saved.previousCRNs.slice(0, 16) };
  } catch { return freshSession(); }
}

export function saveSession(catalog: Catalog, session: AdvisorSession): boolean {
  try { localStorage.setItem(key(catalog), JSON.stringify({ ...session, version: 1, messages: session.messages.slice(-20) })); return true; }
  catch { return false; }
}
