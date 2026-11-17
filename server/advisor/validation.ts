import { applyPatch, emptyPlan, validatePatch } from '../../src/advisor/schema.js';
import type { AdvisorSession, TurnRequest } from '../../src/advisor/contracts.js';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function validateTurn(value: unknown): TurnRequest {
  const invalid = () => { throw new Error('Invalid advisor request. Please reload and try again.'); };
  if (!record(value) || value.type !== 'turn' || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 1500) return invalid();
  const catalog = value.catalog;
  if (!record(catalog) || !['FALL', 'WINTER', 'SUMMER'].includes(String(catalog.term)) || !Number.isInteger(catalog.year) || Number(catalog.year) < 1000 || Number(catalog.year) > 9999) return invalid();
  const session = value.session;
  if (!record(session) || !record(session.plan) || !Array.isArray(session.messages) || session.messages.length > 20 || !Array.isArray(session.previousCRNs) || session.previousCRNs.length > 16 || !session.previousCRNs.every((crn) => typeof crn === 'string' && /^\d{1,20}$/.test(crn))) return invalid();
  const { courses, ...fields } = session.plan;
  if (!Array.isArray(courses)) return invalid();
  if (fields.year === null) delete fields.year;
  if (fields.courseCount === null) delete fields.courseCount;
  const plan = applyPatch(emptyPlan(), validatePatch({ ...fields, addCourses: courses }));
  if (!session.messages.every((message) => record(message) && ['user', 'assistant'].includes(String(message.role)) && typeof message.content === 'string' && message.content.length <= (message.role === 'user' ? 1500 : 6000))) return invalid();
  return { type: 'turn', id: value.id, text: value.text.trim(), catalog: catalog as unknown as TurnRequest['catalog'], session: { plan, messages: session.messages, previousCRNs: session.previousCRNs } as AdvisorSession };
}
