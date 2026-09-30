import { useMemo, useState } from 'react';
import { searchCourse } from './api';
import { CourseList } from './components/CourseList';
import { CourseSearch } from './components/CourseSearch';
import { Header } from './components/Header';
import { PreferencesPanel } from './components/PreferencesPanel';
import { ScheduleView } from './components/ScheduleView';
import { generateSchedules } from './scheduler';
import type { Preferences, SelectedCourse } from './types';

const defaults: Preferences = { beforeEnabled: false, before: '09:00', afterEnabled: false, after: '18:00', prioritizeDaysOff: true };
export default function App() {
  const [courses, setCourses] = useState<SelectedCourse[]>([]); const [preferences, setPreferences] = useState(defaults); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const add = async (code: string) => { if (courses.some((course) => course.code === code)) return setError(`${code} is already in your plan.`); setBusy(true); setError(''); try { setCourses((current) => [...current, { code, sections: await searchCourse(code), disabled: new Set() }]); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Something went wrong.'); } finally { setBusy(false); } };
  const toggle = (code: string, crn: string) => setCourses((current) => current.map((course) => { if (course.code !== code) return course; const disabled = new Set(course.disabled); disabled.has(crn) ? disabled.delete(crn) : disabled.add(crn); return { ...course, disabled }; }));
  const schedules = useMemo(() => generateSchedules(courses, preferences), [courses, preferences]);
  return <><Header /><main><CourseSearch onAdd={add} busy={busy} />{error && <div className="alert" role="alert">{error}<button aria-label="Dismiss" onClick={() => setError('')}>×</button></div>}<CourseList courses={courses} onToggle={toggle} onRemove={(code) => setCourses((current) => current.filter((course) => course.code !== code))} /><PreferencesPanel value={preferences} onChange={setPreferences} /><ScheduleView schedules={schedules} /></main><footer><b>Raven Planner</b><span>Plan smarter. Study better.</span><span>Not affiliated with Carleton University.</span></footer></>;
}
