import { useEffect, useMemo, useRef, useState } from 'react';
import { getCatalog, searchCourse } from './api';
import { CourseList } from './components/CourseList';
import { CourseSearch } from './components/CourseSearch';
import { catalogKey, Header } from './components/Header';
import { PreferencesPanel } from './components/PreferencesPanel';
import { ScheduleView } from './components/ScheduleView';
import { generateSchedules } from './scheduler';
import type { Catalog, Preferences, SelectedCourse } from './types';

const defaults: Preferences = { beforeEnabled: false, before: '09:00', afterEnabled: false, after: '18:00', prioritizeDaysOff: true };
export default function App() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [plans, setPlans] = useState<Record<string, SelectedCourse[]>>({});
  const [preferences, setPreferences] = useState(defaults);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const pendingSearch = useRef<AbortController>();
  useEffect(() => {
    const controller = new AbortController();
    getCatalog(controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      setCatalogs(response.catalogs);
      setCatalog({ term: response.term, year: response.year });
      setError('');
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load terms.');
    });
    return () => controller.abort();
  }, [catalogAttempt]);
  useEffect(() => () => pendingSearch.current?.abort(), []);
  const key = catalog ? catalogKey(catalog) : '';
  const courses = useMemo(() => plans[key] || [], [plans, key]);
  const setCourses = (update: (current: SelectedCourse[]) => SelectedCourse[]) => setPlans((current) => ({ ...current, [key]: update(current[key] || []) }));
  const changeCatalog = (selected: Catalog) => {
    pendingSearch.current?.abort();
    setBusy(false);
    setError('');
    setCatalog(selected);
  };
  const add = async (code: string) => {
    if (!catalog) return;
    if (courses.some((course) => course.code === code)) return setError(`${code} is already in your plan.`);
    const controller = new AbortController();
    pendingSearch.current?.abort();
    pendingSearch.current = controller;
    setBusy(true);
    setError('');
    try {
      const sections = await searchCourse(code, catalog, controller.signal);
      if (!controller.signal.aborted) setCourses((current) => [...current, { code, sections, disabled: new Set() }]);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Something went wrong.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const toggle = (code: string, crn: string) => setCourses((current) => current.map((course) => {
    if (course.code !== code) return course;
    const disabled = new Set(course.disabled);
    if (disabled.has(crn)) disabled.delete(crn);
    else disabled.add(crn);
    return { ...course, disabled };
  }));
  const schedules = useMemo(() => generateSchedules(courses, preferences), [courses, preferences]);
  return <>
    <Header catalog={catalog} catalogs={catalogs} onChange={changeCatalog} />
    <main>
      <CourseSearch onAdd={add} busy={busy} disabled={!catalog} />
      {error && <div className="alert" role="alert">
        {error}
        {!catalog && <button onClick={() => setCatalogAttempt((attempt) => attempt + 1)}>Retry</button>}
        <button aria-label="Dismiss" onClick={() => setError('')}>×</button>
      </div>}
      <CourseList courses={courses} onToggle={toggle} onRemove={(code) => setCourses((current) => current.filter((course) => course.code !== code))} />
      <PreferencesPanel value={preferences} onChange={setPreferences} />
      <ScheduleView key={key} schedules={schedules} />
    </main>
    <footer><b>Raven Planner</b><span>Plan smarter. Study better.</span><span>Not affiliated with Carleton University.</span></footer>
  </>;
}
