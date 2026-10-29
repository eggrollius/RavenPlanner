// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { AdvisorPanel } from './AdvisorPanel';
import { localModel } from '../advisor/model';
import { solvePlan } from '../advisor/solver';
import type { AdvisorTools } from '../advisor/tools';
import type { Course } from '../types';

vi.mock('../advisor/model', () => ({ localModel: { load: vi.fn(), decide: vi.fn(), clearCache: vi.fn(), modelId: undefined }, models: { smol: { label: 'SmolLM2', size: '271 MB' } } }));
const course: Course = { term: 'FALL', year: 2026, id: 1, crn: '12345', course_code: 'ERTH 1006', section: 'A', course_name: 'Earth Science (Demo)', type: 'Lecture', instructor: 'Demo instructor', credits: 0.5, registration_status: 'Open', also_register_in: '', meeting_infos: [{ days: 'Wed', time: '12:00 - 13:00', meeting_date: 'Sep 08, 2026 to Dec 08, 2026', building: '', room: '' }] };
vi.mock('../advisor/tools', () => ({ createTools: () => ({
  search: vi.fn(async () => []), sections: vi.fn(async () => ({ code: 'ERTH 1006', sections: { A: { parent: course, children: [] } }, disabled: new Set() })),
  solve: vi.fn(async (...args: Parameters<AdvisorTools['solve']>) => solvePlan(args[0], args[1], args[2])),
}) }));

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

it('plans and refines from chat, restores the proposal, and resets the conversation', async () => {
  vi.mocked(localModel.decide).mockResolvedValueOnce({ tool: 'plan', patch: { addCourses: ['ERTH 1006'], courseCount: 1, daysOff: ['Fri'] } }).mockResolvedValueOnce({ tool: 'plan', patch: { keepCourses: ['ERTH 1006'], lightDays: ['Tue'] } });
  const user = userEvent.setup();
  const catalog = { term: 'FALL', year: 2026 } as const;
  const view = render(<AdvisorPanel catalog={catalog} />);
  expect(screen.getByRole('button', { name: /Send message/ })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Load model' }));
  await user.type(screen.getByLabelText('Message the advisor'), 'Take ERTH 1006. Fridays off.');
  await user.click(screen.getByRole('button', { name: /Send message/ }));
  expect(await screen.findByText(/Your 1-course timetable is ready/)).toBeInTheDocument();
  expect(screen.getByText('1 conflict-free option')).toBeInTheDocument();
  await user.type(screen.getByLabelText('Message the advisor'), 'Lighter Tuesdays, keep geology.');
  await user.click(screen.getByRole('button', { name: /Send message/ }));
  expect(await screen.findByText('Pinned · ERTH 1006')).toBeInTheDocument();
  expect(screen.getByText('Fri off')).toBeInTheDocument();
  view.unmount();
  render(<AdvisorPanel catalog={catalog} />);
  expect(await screen.findByText('1 conflict-free option')).toBeInTheDocument();
  expect(within(screen.getByLabelText('Saved planning state')).getByText('Lighter Tue')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'New conversation' }));
  expect(screen.getByText('A timetable, in your own words.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Send message/ })).toBeDisabled();
});

it('shows a recoverable error on model load failure', async () => {
  vi.mocked(localModel.load).mockRejectedValueOnce(new Error('Insufficient memory'));
  render(<AdvisorPanel catalog={{ term: 'FALL', year: 2026 }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Load model' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient memory');
  expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled();
});
