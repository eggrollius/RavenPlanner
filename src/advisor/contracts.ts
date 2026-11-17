import type { Catalog, ScheduleSection, SelectedCourse } from '../types.js';
import type { Decision, Plan } from './schema.js';
import type { SolveResult } from './solver.js';

export interface Message { role: 'user' | 'assistant'; content: string }
export interface DecisionContext { plan: Plan; messages: Message[]; observations: string[]; currentSchedule?: string }
export interface AdvisorModel { decide(context: DecisionContext, signal: AbortSignal): Promise<Decision> }
export interface AdvisorSession { plan: Plan; messages: Message[]; previousCRNs: string[] }
export interface TurnResult { plan: Plan; reply: string; schedules?: ScheduleSection[][]; trace: string[]; current: boolean }
export interface CourseSummary { code: string; name: string; instructors: string[] }
export interface AdvisorTools {
  search(query: string, signal: AbortSignal): Promise<CourseSummary[]>;
  sections(code: string, signal: AbortSignal): Promise<SelectedCourse>;
  solve(plan: Plan, courses: SelectedCourse[], previousCRNs: string[], signal: AbortSignal): Promise<SolveResult>;
}
export interface TurnRequest { type: 'turn'; id: string; catalog: Catalog; session: AdvisorSession; text: string }
export interface AdvisorStatus { configured: boolean; phase: 'idle' | 'loading' | 'ready' | 'unavailable' | 'closed'; active: number; queued: number; maxQueued: number }
export type AdvisorEvent =
  | { type: 'status'; id: string; message: string; position?: number }
  | { type: 'delta'; id: string; text: string }
  | { type: 'done'; id: string; result: TurnResult }
  | { type: 'cancelled'; id: string }
  | { type: 'error'; id: string; message: string; code: string };
