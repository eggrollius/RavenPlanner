import type { SelectedCourse } from '../types';

const detail = (meeting?: { days: string; time: string }) => meeting ? `${meeting.days || 'TBA'} · ${meeting.time || 'TBA'}` : 'Time to be announced';

export function CourseList({ courses, onToggle, onRemove }: { courses: SelectedCourse[]; onToggle: (code: string, crn: string) => void; onRemove: (code: string) => void }) {
  if (!courses.length) return <div className="empty-state"><div>＋</div><h3>Your course list is empty</h3><p>Add a course above to start building possible schedules.</p></div>;

  return <div className="course-list">{courses.map((course) => {
    const groups = Object.entries(course.sections);
    const enabled = groups.filter(([, group]) => !course.disabled.has(group.parent.crn)).length;

    return <article className="course-card" key={course.code} aria-label={course.code}>
      <details className="course-disclosure">
        <summary className="course-heading">
          <span className="course-code">{course.code}</span>
          <div className="course-summary">
            <h3>{groups[0]?.[1].parent.course_name || course.code}</h3>
            <span className="course-section-count">{enabled} of {groups.length} lecture sections enabled</span>
          </div>
          <svg className="course-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
        </summary>
        <div className="section-grid">{groups.map(([letter, group]) => <div className="section" key={letter}>
          <label className="section-title">
            <input type="checkbox" checked={!course.disabled.has(group.parent.crn)} onChange={() => onToggle(course.code, group.parent.crn)} />
            <span><b>Lecture {letter}</b><small>{group.parent.instructor || 'Instructor TBA'} · {detail(group.parent.meeting_infos[0])}</small></span>
          </label>
          {group.children.length > 0 && <div className="tutorials">{group.children.map((child) => <label key={child.crn}>
            <input type="checkbox" checked={!course.disabled.has(child.crn)} onChange={() => onToggle(course.code, child.crn)} />
            <span>{child.type || 'Tutorial'} {child.section}</span><small>{detail(child.meeting_infos[0])}</small>
          </label>)}</div>}
        </div>)}</div>
      </details>
      <button type="button" className="icon-button course-remove" aria-label={`Remove ${course.code}`} onClick={() => onRemove(course.code)}>×</button>
    </article>;
  })}</div>;
}
