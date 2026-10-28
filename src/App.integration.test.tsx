// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { Course } from './types';

const course: Course = {
  id: 1,
  registration_status: 'Open',
  crn: '12345',
  course_code: 'COMP 1405',
  section: 'A',
  course_name: 'Introduction to Computer Science I',
  credits: 0.5,
  type: 'Lecture',
  instructor: 'Ada Lovelace',
  also_register_in: '',
  meeting_infos: [{
    meeting_date: 'May 05, 2025 to Jun 16, 2025',
    days: 'Mon Wed',
    time: '10:00 - 11:00',
    building: 'HP',
    room: '1',
  }],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('course planning flow', () => {
  it('searches for a course, displays a schedule, and removes the course', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 'success',
      data: { A: { parent: course, children: [] } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('Department'), 'comp');
    await user.type(screen.getByLabelText('Course number'), '1405');
    await user.click(screen.getByRole('button', { name: /Add course/ }));

    expect(await screen.findByText('Introduction to Computer Science I')).toBeInTheDocument();
    expect(screen.getByText('1 conflict-free option')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getAllByText('COMP 1405').length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith('/api/course/search?query=COMP%201405');

    await user.click(screen.getByRole('button', { name: 'Remove COMP 1405' }));
    expect(screen.getByText('Your course list is empty')).toBeInTheDocument();
  });

  it('shows API errors to the user', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ message: 'No course found matching the query' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    ));
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('Department'), 'comp');
    await user.type(screen.getByLabelText('Course number'), '9999');
    await user.click(screen.getByRole('button', { name: /Add course/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No course found matching the query');
  });
});
