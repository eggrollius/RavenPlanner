import { useState } from 'react';
import { timeRange } from '../scheduler';
import type { ScheduleSection } from '../types';
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']; const start = 7 * 60; const end = 22 * 60;
function ScheduleResults({ schedules }: { schedules: ScheduleSection[][] }) {
  const [index, setIndex] = useState(0); const schedule = schedules[index];
  return <section className="panel schedule-panel"><div className="panel-heading"><div><p className="step-label">03 · Your schedules</p><h2>{schedules.length ? `${schedules.length} conflict-free option${schedules.length === 1 ? '' : 's'}` : 'Your week, at a glance'}</h2></div>{schedules.length > 0 && <div className="pager"><button disabled={index === 0} onClick={() => setIndex(index - 1)}>←</button><span><b>{index + 1}</b> / {schedules.length}</span><button disabled={index === schedules.length - 1} onClick={() => setIndex(index + 1)}>→</button></div>}</div>{!schedule ? <div className="schedule-empty"><div className="mini-calendar">{days.map((day) => <span key={day}>{day[0]}</span>)}</div><h3>No schedule to show yet</h3><p>Add courses to see every conflict-free combination here.</p></div> : <div className="calendar"><div className="day-head" />{days.map((day) => <div className="day-head" key={day}>{day}</div>)}<div className="time-axis">{Array.from({ length: 16 }, (_, i) => <span style={{ top: `${i / 15 * 100}%` }} key={i}>{i + 7}:00</span>)}</div>{days.map((day) => <div className="day-column" key={day}>{schedule.flatMap((section) => [section.parent, section.child].filter(Boolean)).flatMap((course) => course!.meeting_infos.map((meeting) => ({ course: course!, meeting }))).filter(({ meeting }) => meeting.days.split(/\s+/).includes(day)).map(({ course, meeting }, i) => { const range = timeRange(meeting); if (!range) return null; return <div className="class-block" key={`${course.crn}-${i}`} style={{ top: `${(range[0] - start) / (end - start) * 100}%`, height: `${(range[1] - range[0]) / (end - start) * 100}%` }}><b>{course.course_code}</b><span>{course.section} · {meeting.time.split(' - ')[0]}</span></div>; })}</div>)}</div>}</section>;
}

export function ScheduleView({ schedules }: { schedules: ScheduleSection[][] }) {
  const scheduleKey = schedules.map((schedule) => schedule.map(({ parent, child }) => `${parent.crn}:${child?.crn || ''}`).join(',')).join('|');
  return <ScheduleResults key={scheduleKey} schedules={schedules} />;
}
