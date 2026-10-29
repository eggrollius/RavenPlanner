// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { ScheduleView } from './ScheduleView';
import type { Course } from '../types';

afterEach(cleanup);
const lecture: Course = {
  term: 'FALL', year: 2026, id: 1, crn: '12345', course_code: 'COMP 1405', course_name: 'Introduction to Computer Science I',
  section: 'A', type: 'Lecture', registration_status: 'Open', credits: 0.5, instructor: 'Ada', also_register_in: '',
  section_type: 'Online Unscheduled Section', meeting_infos: [],
};
const tutorial: Course = {
  ...lecture, id: 2, crn: '12346', section: 'A1', type: 'Tutorial', section_type: 'In-person section',
  meeting_infos: [{ days: 'Mon', time: '10:00 - 11:00', meeting_date: 'Sep 01, 2026 to Dec 01, 2026', building: 'HP', room: '1' }],
};

it('lists the selected unscheduled lecture with its CRN while rendering its scheduled tutorial in the calendar', () => {
  render(<ScheduleView schedules={[[{ parent: lecture, child: tutorial }]]} />);
  const list = screen.getByRole('region', { name: 'Unscheduled classes 1' });
  expect(within(list).getByText('Lecture A · CRN 12345')).toBeInTheDocument();
  expect(within(list).getByText(lecture.course_name)).toBeInTheDocument();
  expect(within(list).queryByText(/Tutorial A1/)).not.toBeInTheDocument();
  const calendar = screen.getByRole('region', { name: 'Weekly calendar' });
  expect(within(calendar).getByText('A1 · 10:00')).toBeInTheDocument();
  expect(within(calendar).queryByText('A · 10:00')).not.toBeInTheDocument();
});

it('omits unscheduled calendar blocks even when timing metadata exists, and explains an entirely unscheduled option', () => {
  render(<ScheduleView schedules={[[{ parent: { ...lecture, meeting_infos: tutorial.meeting_infos }, child: { ...tutorial, section_type: 'Online Unscheduled Section with In-Person Assessments (Campus presence)' } }]]} />);
  const list = screen.getByRole('region', { name: 'Unscheduled classes 2' });
  expect(within(list).getByText('Tutorial A1 · CRN 12346')).toBeInTheDocument();
  expect(screen.getByText(/This option has no scheduled class times/)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Weekly calendar' })).queryByText('COMP 1405')).not.toBeInTheDocument();
});

it('updates the unscheduled list when changing schedule options', async () => {
  const user = userEvent.setup();
  render(<ScheduleView schedules={[[{ parent: lecture }], [{ parent: { ...lecture, crn: '12347', section: 'B' } }], [{ parent: tutorial }]]} />);
  await user.click(screen.getByRole('button', { name: 'Next schedule' }));
  expect(screen.queryByText('Lecture A · CRN 12345')).not.toBeInTheDocument();
  expect(screen.getByText('Lecture B · CRN 12347')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next schedule' }));
  expect(screen.queryByRole('region', { name: /Unscheduled classes/ })).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Weekly calendar' })).getByText('A1 · 10:00')).toBeInTheDocument();
});

it('keeps a section with unknown delivery type and missing times distinct from confirmed unscheduled classes', () => {
  render(<ScheduleView schedules={[[{ parent: { ...lecture, section_type: null } }]]} />);
  expect(screen.queryByRole('region', { name: /Unscheduled classes/ })).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Meeting times to be announced 1' })).getByText('Lecture A · CRN 12345')).toBeInTheDocument();
});
