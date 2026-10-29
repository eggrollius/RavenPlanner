import { useEffect, useState } from 'react';
import { getCatalog } from '../api';

export function Header() {
  const [label, setLabel] = useState('Course catalog');
  useEffect(() => {
    const controller = new AbortController();
    getCatalog(controller.signal).then(({ term, year }) => {
      if (!controller.signal.aborted) setLabel(`${term.charAt(0).toUpperCase()}${term.slice(1).toLowerCase()} ${year}`);
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  return <header className="hero"><div className="brand-mark" aria-hidden="true">R</div><div><p className="eyebrow">Carleton University</p><h1>Raven Planner</h1><p className="tagline">Build a timetable that works for you.</p></div><div className="term-pill"><span className="pulse" />{label}</div></header>;
}
