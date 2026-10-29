import type { Catalog } from '../types';

export const catalogKey = ({ term, year }: Catalog) => `${term}-${year}`;
const label = ({ term, year }: Catalog) => `${term.charAt(0)}${term.slice(1).toLowerCase()} ${year}`;

export function Header({ catalog, catalogs, onChange }: { catalog?: Catalog; catalogs: Catalog[]; onChange: (catalog: Catalog) => void }) {
  return <header className="hero">
    <div className="brand-mark" aria-hidden="true">R</div>
    <div><p className="eyebrow">Carleton University</p><h1>Raven Planner</h1><p className="tagline">Build a timetable that works for you.</p></div>
    <label className="term-pill">
      <span>Term</span>
      <select aria-label="Term" disabled={!catalog} value={catalog ? catalogKey(catalog) : ''} onChange={(event) => {
        const selected = catalogs.find((entry) => catalogKey(entry) === event.target.value);
        if (selected) onChange(selected);
      }}>
        {!catalog && <option value="">Loading terms…</option>}
        {catalogs.map((entry) => <option key={catalogKey(entry)} value={catalogKey(entry)}>{label(entry)}</option>)}
      </select>
    </label>
  </header>;
}
