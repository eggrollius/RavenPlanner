// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { Course } from './types';

const course: Course = {
  term: 'FALL',
  year: 2026,
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

const catalogs = [{ term: 'FALL', year: 2026 }, { term: 'SUMMER', year: 2026 }, { term: 'WINTER', year: 2027 }];
const catalogResponse = { ...catalogs[0], catalogs };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('course planning flow', () => {
  it('searches for a course, displays a schedule, and removes the course', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify(url === '/api/catalog' ? catalogResponse : {
      status: 'success',
      data: { A: { parent: course, children: [] } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('Fall 2026')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Department'), 'comp');
    await user.type(screen.getByLabelText('Course number'), '1405');
    await user.click(screen.getByRole('button', { name: /Add course/ }));

    expect(await screen.findByText('Introduction to Computer Science I')).toBeInTheDocument();
    expect(screen.getByText('1 conflict-free option')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getAllByText('COMP 1405').length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith('/api/course/search?query=COMP+1405&term=FALL&year=2026', { signal: expect.any(AbortSignal) });

    await user.click(screen.getByRole('button', { name: 'Remove COMP 1405' }));
    expect(screen.getByText('Your course list is empty')).toBeInTheDocument();
  });

  it('shows API errors to the user', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(
      JSON.stringify(url === '/api/catalog' ? catalogResponse : { message: 'No course found matching the query' }),
      { status: url === '/api/catalog' ? 200 : 400, headers: { 'Content-Type': 'application/json' } },
    ));
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('Department'), 'comp');
    await user.type(screen.getByLabelText('Course number'), '9999');
    await user.click(screen.getByRole('button', { name: /Add course/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No course found matching the query');
  });

  it('updates the displayed term from the API configuration', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ term: 'WINTER', year: 2027, catalogs })));
    render(<App />);
    expect(await screen.findByText('Winter 2027')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Term' })).toHaveValue('WINTER-2027');
    expect(fetch).toHaveBeenCalledWith('/api/catalog', { signal: expect.any(AbortSignal) });
  });

  it('keeps each term’s courses and section choices separate when switching terms', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/catalog') return new Response(JSON.stringify(catalogResponse));
      const term = new URL(String(url), 'http://localhost').searchParams.get('term');
      return new Response(JSON.stringify({ data: { A: { parent: { ...course, course_name: `${term} course` }, children: [] } } }));
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Fall 2026');
    await user.type(screen.getByLabelText('Department'), 'COMP');
    await user.type(screen.getByLabelText('Course number'), '1405');
    await user.click(screen.getByRole('button', { name: /Add course/ }));
    await screen.findByText('FALL course');
    await user.click(screen.getByRole('checkbox', { name: /Lecture A/ }));
    expect(screen.getByRole('checkbox', { name: /Lecture A/ })).not.toBeChecked();

    for (const term of ['SUMMER-2026', 'WINTER-2027']) {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Term' }), term);
      expect(screen.getByText('Your course list is empty')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Add course/ }));
      await screen.findByText(`${term.split('-')[0]} course`);
      expect(screen.getByRole('checkbox', { name: /Lecture A/ })).toBeChecked();
    }
    await user.selectOptions(screen.getByRole('combobox', { name: 'Term' }), 'FALL-2026');
    expect(screen.getByText('FALL course')).toBeInTheDocument();
    expect(screen.queryByText('WINTER course')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Lecture A/ })).not.toBeChecked();
  });

  it('ignores a late search response after the user changes terms', async () => {
    let finishSearch!: (response: Response) => void;
    let searchSignal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (url === '/api/catalog') return new Response(JSON.stringify(catalogResponse));
      searchSignal = options?.signal;
      return new Promise<Response>((resolve) => { finishSearch = resolve; });
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Fall 2026');
    await user.type(screen.getByLabelText('Department'), 'COMP');
    await user.type(screen.getByLabelText('Course number'), '1405');
    await user.click(screen.getByRole('button', { name: /Add course/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Term' }), 'WINTER-2027');
    expect(searchSignal?.aborted).toBe(true);
    await act(async () => { finishSearch(new Response(JSON.stringify({ data: { A: { parent: course, children: [] } } }))); });
    expect(screen.getByText('Your course list is empty')).toBeInTheDocument();
    expect(screen.queryByText(course.course_name)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add course/ })).toBeEnabled();
  });

  it('blocks searches if loading catalogs fails and lets the user retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(new Response(JSON.stringify(catalogResponse)));
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    expect(screen.getByRole('button', { name: /Add course/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Fall 2026');
    expect(screen.getByRole('button', { name: /Add course/ })).toBeEnabled();
  });
});
