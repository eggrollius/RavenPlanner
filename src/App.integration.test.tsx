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
  it('starts courses collapsed, adds the newest first, and retains section choices after collapsing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/catalog') return new Response(JSON.stringify(catalogResponse));
      const code = new URL(String(url), 'http://localhost').searchParams.get('query')!;
      return new Response(JSON.stringify({ data: { A: { parent: { ...course, course_code: code }, children: [] } } }));
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Fall 2026');
    await user.type(screen.getByLabelText('Department'), 'COMP');
    await user.type(screen.getByLabelText('Course number'), '1405');
    await user.click(screen.getByRole('button', { name: /Add course/ }));
    const first = await screen.findByRole('article', { name: 'COMP 1405' });
    expect(first.querySelector('details')).not.toHaveAttribute('open');
    expect(within(first).getByRole('checkbox')).not.toBeVisible();

    await user.click(within(first).getByText(course.course_name));
    await user.click(within(first).getByRole('checkbox', { name: /Lecture A/ }));
    await user.click(within(first).getByText(course.course_name));
    expect(first.querySelector('details')).not.toHaveAttribute('open');
    expect(within(first).getByText('0 of 1 lecture sections enabled')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Course number'));
    await user.type(screen.getByLabelText('Course number'), '1406');
    await user.click(screen.getByRole('button', { name: /Add course/ }));
    await screen.findByRole('article', { name: 'COMP 1406' });
    expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['COMP 1406', 'COMP 1405']);
    await user.click(within(first).getByText(course.course_name));
    expect(within(first).getByRole('checkbox', { name: /Lecture A/ })).not.toBeChecked();
  });

  it('supports keyboard navigation, selection, and dismissal in the term menu', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(catalogResponse)));
    const user = userEvent.setup();
    render(<App />);
    const trigger = await screen.findByRole('button', { name: 'Academic term: Fall 2026' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Fall 2026' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('option', { name: 'Winter 2027' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveTextContent('Winter 2027');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.keyboard('{ArrowDown}{Home}');
    expect(screen.getByRole('option', { name: 'Fall 2026' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveTextContent('Winter 2027');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    await user.click(screen.getByRole('heading', { name: 'Raven Planner' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it.each(['Tutorial', 'Lab'])('removes invalid schedules when the only required %s is deselected and restores them when reselected', async (type) => {
    const child: Course = {
      ...course, id: 2, crn: '12346', section: 'A1', type,
      meeting_infos: [{ ...course.meeting_infos[0], days: 'Tue', time: '12:00 - 13:00' }],
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify(
      url === '/api/catalog' ? catalogResponse : { data: { A: { parent: course, children: [child] } } },
    )));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Fall 2026');
    await user.type(screen.getByLabelText('Department'), 'COMP');
    await user.type(screen.getByLabelText('Course number'), '1405');
    await user.click(screen.getByRole('button', { name: /Add course/ }));
    expect(await screen.findByText('1 conflict-free option')).toBeInTheDocument();
    expect(screen.getByText('A1 · 12:00')).toBeInTheDocument();

    await user.click(screen.getByText(course.course_name));
    await user.click(screen.getByRole('checkbox', { name: new RegExp(`${type} A1`) }));
    expect(screen.getByRole('checkbox', { name: /Lecture A/ })).toBeChecked();
    expect(screen.queryByText('1 conflict-free option')).not.toBeInTheDocument();
    expect(screen.queryAllByText('A · 10:00')).toHaveLength(0);
    expect(screen.queryByText('A1 · 12:00')).not.toBeInTheDocument();
    expect(screen.getByText('No schedule to show yet')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: new RegExp(`${type} A1`) }));
    expect(screen.getByText('1 conflict-free option')).toBeInTheDocument();
    expect(screen.getAllByText('A · 10:00')).toHaveLength(2);
    expect(screen.getByText('A1 · 12:00')).toBeInTheDocument();
  });

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

  it('labels an unscheduled section in the picker and keeps it in the generated option alongside a scheduled tutorial', async () => {
    const parent = { ...course, section_type: 'Online Unscheduled Section', meeting_infos: [] };
    const child = { ...course, id: 2, crn: '12346', section: 'A1', type: 'Tutorial', section_type: 'Online Scheduled Section' };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify(url === '/api/catalog'
      ? catalogResponse
      : { status: 'success', data: { A: { parent, children: [child] } } })));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Fall 2026');
    await user.type(screen.getByLabelText('Department'), 'comp');
    await user.type(screen.getByLabelText('Course number'), '1405');
    await user.click(screen.getByRole('button', { name: /Add course/ }));

    const card = await screen.findByRole('article', { name: 'COMP 1405' });
    await user.click(within(card).getByText(course.course_name));
    expect(screen.getByText(/Unscheduled · No fixed class time/)).toBeInTheDocument();
    expect(screen.getByText('1 conflict-free option')).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Unscheduled classes 1' });
    expect(within(list).getByText('Lecture A · CRN 12345')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Weekly calendar' })).getAllByText('A1 · 10:00')).toHaveLength(2);

    await user.click(screen.getByRole('checkbox', { name: /Lecture A/ }));
    expect(screen.queryByRole('region', { name: /Unscheduled classes/ })).not.toBeInTheDocument();
    expect(screen.getByText('No schedule to show yet')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Lecture A/ }));
    expect(screen.getByRole('region', { name: 'Unscheduled classes 1' })).toBeInTheDocument();
  });

  it('updates the displayed term from the API configuration', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ term: 'WINTER', year: 2027, catalogs })));
    render(<App />);
    expect(await screen.findByText('Winter 2027')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Academic term: Winter 2027' })).toBeInTheDocument();
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
    await user.click(await screen.findByText('FALL course'));
    await user.click(screen.getByRole('checkbox', { name: /Lecture A/ }));
    expect(screen.getByRole('checkbox', { name: /Lecture A/ })).not.toBeChecked();

    for (const term of ['SUMMER-2026', 'WINTER-2027']) {
      await user.click(screen.getByRole('button', { name: /Academic term:/ }));
      const [season, year] = term.split('-');
      await user.click(screen.getByRole('option', { name: `${season[0]}${season.slice(1).toLowerCase()} ${year}` }));
      expect(screen.getByText('Your course list is empty')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Add course/ }));
      await user.click(await screen.findByText(`${term.split('-')[0]} course`));
      expect(screen.getByRole('checkbox', { name: /Lecture A/ })).toBeChecked();
    }
    await user.click(screen.getByRole('button', { name: /Academic term:/ }));
    await user.click(screen.getByRole('option', { name: 'Fall 2026' }));
    await user.click(screen.getByText('FALL course'));
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
    await user.click(screen.getByRole('button', { name: /Academic term:/ }));
    await user.click(screen.getByRole('option', { name: 'Winter 2027' }));
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
