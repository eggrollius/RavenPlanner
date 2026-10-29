import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Catalog } from '../types';

export const catalogKey = ({ term, year }: Catalog) => `${term}-${year}`;
const catalogLabel = ({ term, year }: Catalog) => `${term.charAt(0).toUpperCase()}${term.slice(1).toLowerCase()} ${year}`;
const sameCatalog = (a: Catalog, b: Catalog) => a.term === b.term && a.year === b.year;

export function Header({ catalog, catalogs, onChange }: { catalog?: Catalog; catalogs: Catalog[]; onChange: (catalog: Catalog) => void }) {
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    picker.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    const options = Array.from(picker.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key.length === 1 && /[a-z]/i.test(event.key)) {
      next = options.findIndex((option, offset) => offset > index && option.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
      if (next < 0) next = options.findIndex((option) => option.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
    } else return;
    event.preventDefault();
    options[next]?.focus();
  };

  return <header className="hero">
    <div className="brand-mark" aria-hidden="true">R</div>
    <div><p className="eyebrow">Carleton University</p><h1>Raven Planner</h1><p className="tagline">Build a timetable that works for you.</p></div>
    <div className="term-picker" ref={picker} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button className="term-trigger" type="button" ref={trigger} disabled={!catalog} aria-label={`Academic term: ${catalog ? catalogLabel(catalog) : 'Loading catalog'}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
        <svg className="term-calendar" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="4.5" width="14" height="13" rx="3" /><path d="M6.5 2.5v4m7-4v4M3 9h14" /></svg>
        <span><small>Academic term</small><b>{catalog ? catalogLabel(catalog) : 'Course catalog'}</b></span>
        <svg className="term-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
      </button>
      {open && <div className="term-menu">
        <p className="term-menu-label">Choose your term</p>
        <div id={listId} role="listbox" aria-label="Academic term" onKeyDown={navigate} className="term-options">
          {catalogs.map((option) => <button type="button" role="option" tabIndex={-1} aria-selected={catalog && sameCatalog(catalog, option)} key={`${option.term}-${option.year}`} onClick={() => {
            if (!catalog || !sameCatalog(catalog, option)) onChange(option);
            close();
          }}>
            <span>{catalogLabel(option)}</span>
            {catalog && sameCatalog(catalog, option) && <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4.5 10 3.5 3.5 7.5-7.5" /></svg>}
          </button>)}
        </div>
      </div>}
    </div>
  </header>;
}
