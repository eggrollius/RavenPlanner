import { FormEvent, useState } from 'react';

export function CourseSearch({ onAdd, busy }: { onAdd: (code: string) => Promise<void>; busy: boolean }) {
  const [department, setDepartment] = useState(''); const [number, setNumber] = useState('');
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!department.trim() || !number.trim()) return; await onAdd(`${department.trim().toUpperCase()} ${number.trim()}`); };
  return <form className="search-card" onSubmit={submit}>
    <div><p className="step-label">01 · Courses</p><h2>What are you taking?</h2><p>Search by department and course number, then fine-tune your sections.</p></div>
    <div className="search-fields"><label>Department<input aria-label="Department" value={department} maxLength={8} placeholder="COMP" onChange={(e) => setDepartment(e.target.value.replace(/[^a-z]/gi, ''))} /></label><span className="course-divider" /><label>Course number<input aria-label="Course number" value={number} maxLength={8} placeholder="1405" onChange={(e) => setNumber(e.target.value.replace(/[^0-9A-Za-z]/g, ''))} /></label><button disabled={busy}>{busy ? 'Searching…' : <><span>+</span> Add course</>}</button></div>
  </form>;
}
