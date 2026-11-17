// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdvisorPanel } from './AdvisorPanel';
import { advisorStatus, streamTurn } from '../advisor/model';
import { applyPatch, emptyPlan } from '../advisor/schema';
import { solvePlan } from '../advisor/solver';
import type { AdvisorTools } from '../advisor/tools';
import type { Course } from '../types';

vi.mock('../advisor/model', () => ({ advisorStatus: vi.fn(), streamTurn: vi.fn() }));
const course: Course = { term: 'FALL', year: 2026, id: 1, crn: '12345', course_code: 'ERTH 1006', section: 'A', course_name: 'Earth Science (Demo)', type: 'Lecture', instructor: 'Demo instructor', credits: 0.5, registration_status: 'Open', also_register_in: '', meeting_infos: [{ days: 'Wed', time: '12:00 - 13:00', meeting_date: 'Sep 08, 2026 to Dec 08, 2026', building: '', room: '' }] };
const selected = { code: 'ERTH 1006', sections: { A: { parent: course, children: [] } }, disabled: new Set<string>() };
vi.mock('../advisor/tools', () => ({ createTools: () => ({
  search: vi.fn(async () => []), sections: vi.fn(async () => selected),
  solve: vi.fn(async (...args: Parameters<AdvisorTools['solve']>) => solvePlan(args[0], args[1], args[2])),
}) }));
beforeEach(() => vi.mocked(advisorStatus).mockResolvedValue({ configured: true, phase: 'ready', active: 0, queued: 0, maxQueued: 4 }));
afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); });

it('shows chunks before completion, commits only the completed plan, and restores after reload', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  vi.mocked(streamTurn).mockImplementationOnce(async (_catalog, session, _text, _signal, status, delta) => {
    status('Writing your reply…'); delta('Your timetable');
    await pending;
    delta(' is ready.');
    const plan = applyPatch(session.plan, { addCourses: ['ERTH 1006'], courseCount: 1, daysOff: ['Fri'] });
    return { plan, reply: 'Your timetable is ready.', schedules: solvePlan(plan, [selected]).schedules, current: true, trace: ['server_model: plan'] };
  }).mockImplementationOnce(async (_catalog, session) => {
    const plan = applyPatch(session.plan, { keepCourses: ['ERTH 1006'], lightDays: ['Tue'] });
    return { plan, reply: 'Kept geology and lightened Tuesday.', schedules: solvePlan(plan, [selected]).schedules, current: true, trace: [] };
  });
  const user = userEvent.setup();
  const catalog = { term: 'FALL', year: 2026 } as const;
  const view = render(<AdvisorPanel catalog={catalog} />);
  expect(await screen.findByText('Advisor connected')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load model' })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Message the advisor'), 'Take ERTH 1006. Fridays off.');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(await screen.findByLabelText('Advisor reply in progress')).toHaveTextContent('Your timetable');
  expect(screen.queryByText('Fri off')).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('raven-advisor-v1:FALL:2026')!).plan.courses).toEqual([]);
  await act(async () => finish());
  expect(await screen.findByText('Your timetable is ready.')).toBeInTheDocument();
  expect(screen.getByText('1 conflict-free option')).toBeInTheDocument();
  await user.type(screen.getByLabelText('Message the advisor'), 'Lighter Tuesdays, keep geology.');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(await screen.findByText('Pinned · ERTH 1006')).toBeInTheDocument();
  view.unmount();
  render(<AdvisorPanel catalog={catalog} />);
  expect(await screen.findByText('1 conflict-free option')).toBeInTheDocument();
  expect(within(screen.getByLabelText('Saved planning state')).getByText('Lighter Tue')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'New conversation' }));
  expect(screen.getByText('A timetable, in your own words.')).toBeInTheDocument();
});

it('cancels a streaming reply without saving partial text or changing requirements', async () => {
  vi.mocked(streamTurn).mockImplementationOnce(async (_catalog, _session, _text, signal, _status, delta) => {
    delta('Partial response');
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  });
  const user = userEvent.setup();
  render(<AdvisorPanel catalog={{ term: 'FALL', year: 2026 }} />);
  await screen.findByText('Advisor connected');
  await user.type(screen.getByLabelText('Message the advisor'), 'Plan my schedule.');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(await screen.findByLabelText('Advisor reply in progress')).toHaveTextContent('Partial response');
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  expect(screen.queryByLabelText('Advisor reply in progress')).not.toBeInTheDocument();
  const saved = JSON.parse(localStorage.getItem('raven-advisor-v1:FALL:2026')!);
  expect(saved.plan).toEqual(emptyPlan());
  expect(saved.messages.some((message: { role: string }) => message.role === 'assistant')).toBe(false);
});

it('reports server unavailability and can reconnect', async () => {
  vi.mocked(advisorStatus).mockResolvedValueOnce({ configured: false, phase: 'idle', active: 0, queued: 0, maxQueued: 4 });
  render(<AdvisorPanel catalog={{ term: 'FALL', year: 2026 }} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('not configured');
  await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  expect(await screen.findByText('Advisor connected')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('reports a disconnect without committing a proposed change', async () => {
  vi.mocked(streamTurn).mockRejectedValueOnce(new Error('The advisor disconnected. Your saved plan is unchanged.'));
  const user = userEvent.setup();
  render(<AdvisorPanel catalog={{ term: 'FALL', year: 2026 }} />);
  await screen.findByText('Advisor connected');
  await user.type(screen.getByLabelText('Message the advisor'), 'Fridays off.');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('disconnected');
  expect(screen.getByLabelText('Message the advisor')).toHaveValue('Fridays off.');
  expect(JSON.parse(localStorage.getItem('raven-advisor-v1:FALL:2026')!).plan.daysOff).toEqual([]);
});
