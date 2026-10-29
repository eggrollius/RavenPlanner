import { useState } from 'react';
import { isUnscheduled, scheduleCourses, scheduledMeetings, timeRange } from '../scheduler';
import type { Course, ScheduleSection } from '../types';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const start = 7 * 60;
const end = 22 * 60;

function SectionList({ courses, pending = false }: { courses: Course[]; pending?: boolean }) {
  if (!courses.length) return null;
  const heading = pending ? 'pending-heading' : 'unscheduled-heading';
  return <section className="untimed-classes" aria-labelledby={heading}>
    <h3 id={heading}>{pending ? 'Meeting times to be announced' : 'Unscheduled classes'} <span className="class-count">{courses.length}</span></h3>
    <p>{pending
      ? 'These sections are included in this option, but their meeting times are unavailable. Check Carleton Central before registering.'
      : 'Included in this schedule with no fixed class time, so they do not appear on the calendar. Check the course outline for coursework, deadlines, and assessments.'}</p>
    <ul>{courses.map((course) => <li key={course.crn}>
      <div><b>{course.course_code}</b><span>{course.type || 'Section'} {course.section} · CRN {course.crn}</span></div>
      <span>{course.course_name}</span>
      {course.instructor && <small>{course.instructor}</small>}
    </li>)}</ul>
  </section>;
}

function ScheduleResults({ schedules }: { schedules: ScheduleSection[][] }) {
  const [index, setIndex] = useState(0);
  const schedule = schedules[index];
  const courses = schedule?.flatMap(scheduleCourses) || [];
  const unscheduled = courses.filter(isUnscheduled);
  const timed = courses.flatMap((course) => scheduledMeetings(course).map((meeting) => ({ course, meeting })));
  const pending = courses.filter((course) => !isUnscheduled(course) && (!course.meeting_infos.length || course.meeting_infos.some((meeting) => !timeRange(meeting) || !meeting.days.trim() || /^TBA$/i.test(meeting.days.trim()))));

  return <section className="panel schedule-panel">
    <div className="panel-heading">
      <div><p className="step-label">03 · Your schedules</p><h2>{schedules.length ? `${schedules.length} conflict-free option${schedules.length === 1 ? '' : 's'}` : 'Your week, at a glance'}</h2></div>
      {schedules.length > 0 && <div className="pager">
        <button aria-label="Previous schedule" disabled={index === 0} onClick={() => setIndex(index - 1)}>←</button>
        <span><b>{index + 1}</b> / {schedules.length}</span>
        <button aria-label="Next schedule" disabled={index === schedules.length - 1} onClick={() => setIndex(index + 1)}>→</button>
      </div>}
    </div>
    {!schedule ? <div className="schedule-empty">
      <div className="mini-calendar">{days.map((day) => <span key={day}>{day[0]}</span>)}</div>
      <h3>No schedule to show yet</h3><p>Add courses to see every conflict-free combination here.</p>
    </div> : <>
      <SectionList courses={unscheduled} />
      <SectionList courses={pending} pending />
      {courses.length === unscheduled.length && <p className="calendar-note">This option has no scheduled class times. Your unscheduled classes are listed above.</p>}
      <div className="calendar-scroll" role="region" aria-label="Weekly calendar" tabIndex={0}>
        <div className="calendar">
          <div className="day-head" />{days.map((day) => <div className="day-head" key={day}>{day}</div>)}
          <div className="time-axis">{Array.from({ length: 16 }, (_, i) => <span style={{ top: `${i / 15 * 100}%` }} key={i}>{i + 7}:00</span>)}</div>
          {days.map((day) => <div className="day-column" key={day}>
            {timed.filter(({ meeting }) => meeting.days.split(/\s+/).includes(day)).map(({ course, meeting }, i) => {
              const range = timeRange(meeting);
              if (!range) return null;
              return <div className="class-block" key={`${course.crn}-${i}`} style={{ top: `${(range[0] - start) / (end - start) * 100}%`, height: `${(range[1] - range[0]) / (end - start) * 100}%` }}>
                <b>{course.course_code}</b><span>{course.section} · {meeting.time.split(' - ')[0]}</span>
              </div>;
            })}
          </div>)}
        </div>
      </div>
    </>}
  </section>;
}

export function ScheduleView({ schedules }: { schedules: ScheduleSection[][] }) {
  const scheduleKey = schedules.map((schedule) => schedule.map(({ parent, child }) => `${parent.crn}:${child?.crn || ''}`).join(',')).join('|');
  return <ScheduleResults key={scheduleKey} schedules={schedules} />;
}
