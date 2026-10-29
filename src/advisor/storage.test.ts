// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyPatch, emptyPlan } from './schema';
import { freshSession, readSession, saveSession } from './storage';

afterEach(() => localStorage.clear());
describe('term-scoped advisor persistence', () => {
  const fall = { term: 'FALL', year: 2026 } as const;
  it('restores structured constraints, pinned courses, messages and selected CRNs', () => {
    const session = { plan: applyPatch(emptyPlan(), { program: 'CS', year: 4, courseCount: 2, addCourses: ['COMP 1405', 'ERTH 1006'], keepCourses: ['ERTH 1006'], daysOff: ['Fri'], lightDays: ['Tue'] }), messages: [{ role: 'user' as const, content: 'Keep geology' }], previousCRNs: ['12345'] };
    expect(saveSession(fall, session)).toBe(true);
    expect(readSession(fall)).toEqual(session);
    expect(readSession({ term: 'WINTER', year: 2027 })).toEqual(freshSession());
  });
  it('recovers from malformed or incompatible browser storage', () => {
    localStorage.setItem('raven-advisor-v1:FALL:2026', '{invalid');
    expect(readSession(fall)).toEqual(freshSession());
    localStorage.setItem('raven-advisor-v1:FALL:2026', JSON.stringify({ ...freshSession(), version: 1, plan: { ...emptyPlan(), daysOff: ['Saturday'] } }));
    expect(readSession(fall)).toEqual(freshSession());
  });
});
