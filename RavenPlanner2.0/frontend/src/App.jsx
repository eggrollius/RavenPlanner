import { useState, useMemo } from 'react';
import './App.css';

// Fake course data for demo
const FAKE_COURSE_CODES = [
  { code: 'COMP 1406', name: 'Introduction to Computer Science I' },
  { code: 'MATH 1007', name: 'Elementary Calculus I' },
]

const FAKE_COURSES = [
  {
    code: 'COMP 1406',
    name: 'Introduction to Computer Science I',
    section: 'A',
    type: 'Lecture',
    instructor: 'Dr. Smith',
    credits: 0.5,
    semester: 'Summer',
    year: 2025,
    also_register_in: 'COMP 1406 A01',
    meetings: [
      {
        days: ['Mon', 'Wed'],
        times: [{"start": '10:05', "end": '11:25'}, {"start": '10:05', "end": '11:25'}],
        building: 'HP',
        room: '4155'
      }
    ],
    child_sections: [
      {
        section: 'A01',
        type: 'Tutorial',
        instructor: 'TA John',
        credits: 0,
        semester: 'Summer',
        year: 2025,
        meetings: [
          {
            days: ['Fri'],
            times: [{"start": '13:05', "end": '14:25'}],
            building: 'HP',
            room: '4155'
          }
        ]
      },
      {
        section: 'A02',
        type: 'Tutorial',
        instructor: 'TA Bobby',
        credits: 0,
        semester: 'Summer',
        year: 2025,
        meetings: [
          {
            days: ['Thu'],
            times: [{"start": '13:05', "end": '14:25'}],
            building: 'HP',
            room: '4155'
          }
        ]
      }
    ]
  },
    {
    code: 'COMP 1406',
    name: 'Introduction to Computer Science I',
    section: 'B',
    type: 'Lecture',
    instructor: 'Dr. Dill',
    credits: 0.5,
    semester: 'Summer',
    year: 2025,
    also_register_in: 'COMP 1406 B01',
    meetings: [
      {
        days: ['Tue', 'Fri'],
        times: [{"start": '10:05', "end": '11:25'}, {"start": '10:05', "end": '11:25'}],
        building: 'HP',
        room: '4155'
      }
    ],
    child_sections: [
      {
        section: 'B01',
        type: 'Tutorial',
        instructor: 'TA John',
        credits: 0,
        semester: 'Summer',
        year: 2025,
        meetings: [
          {
            days: ['Fri'],
            times: [{"start": '13:05', "end": '14:25'}],
            building: 'HP',
            room: '4155'
          }
        ]
      },
      {
        section: 'B02',
        type: 'Tutorial',
        instructor: 'TA Bobby',
        credits: 0,
        semester: 'Summer',
        year: 2025,
        meetings: [
          {
            days: ['Thu'],
            times: [{"start": '13:05', "end": '14:25'}],
            building: 'HP',
            room: '4155'
          }
        ]
      }
    ]
  },
  {
    code: 'MATH 1007',
    name: 'Elementary Calculus I',
    section: 'A',
    type: 'Lecture',
    instructor: 'Dr. Lee',
    credits: 0.5,
    semester: 'Summer',
    year: 2025,
    also_register_in: '',
    meetings: [
      {
        days: ['Tue', 'Thu'],
        times: [{"start": '13:05', "end": '14:25'}, {"start": '13:05', "end": '14:25'}],
        building: 'TB',
        room: '202'
      }
    ],
    child_sections: []
  }
];

function generateFakeSchedules(courseInputs) {
  function timeConflict(a, b) {
    return a.day === b.day && !(a.end <= b.start || b.end <= a.start);
  }

  function expandSection(course) {
    const combos = [];

    course.meetings.forEach(parentMeeting => {
      const parentSlots = parentMeeting.days.map((day, i) => ({
        code: course.code,
        section: course.section,
        name: course.name,
        day,
        start: parentMeeting.times[i].start,
        end: parentMeeting.times[i].end
      }));

      if (!course.child_sections || course.child_sections.length === 0) {
        combos.push(parentSlots);
      }

      course.child_sections.forEach(child => {
        child.meetings.forEach(childMeeting => {
          const childSlots = childMeeting.days.map((day, i) => ({
            code: course.code,
            section: child.section,
            name: course.name,
            day,
            start: childMeeting.times[i].start,
            end: childMeeting.times[i].end
          }));
          combos.push([...parentSlots, ...childSlots]);
        });
      });
    });

    return combos;
  }

  // Step 1: for each input course, find all FAKE_COURSES that match the code
  const allCourseOptions = courseInputs.map(({ code }) => {
    const matchingSections = FAKE_COURSES.filter(c => c.code === code);
    return matchingSections.flatMap(expandSection); // all possible versions
  });

  // Step 2: Backtrack to generate all conflict-free combinations
  const validSchedules = [];

  function backtrack(i, currentSchedule) {
    if (i === allCourseOptions.length) {
      validSchedules.push(currentSchedule);
      return;
    }

    for (const option of allCourseOptions[i]) {
      const hasConflict = option.some(newSlot =>
        currentSchedule.some(existingSlot => timeConflict(newSlot, existingSlot))
      );
      if (!hasConflict) {
        backtrack(i + 1, [...currentSchedule, ...option]);
      }
    }
  }

  backtrack(0, []);
  return validSchedules;
}



function App() {
  const [search, setSearch] = useState('');
  const [addedCourses, setAddedCourses] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeTab, setActiveTab] = useState('add');
  const [scheduleIdx, setScheduleIdx] = useState(0);
  const schedules = useMemo(() => generateFakeSchedules(addedCourses), [addedCourses]);
  const currentSchedule = schedules[scheduleIdx] || [];

  // Filtered suggestions based on search
  const suggestions = useMemo(() => {
    if (!search.trim()) return [];
    const lower = search.toLowerCase();
    return FAKE_COURSE_CODES.filter(
      c => c.code.toLowerCase().includes(lower) || c.name.toLowerCase().includes(lower)
    ).filter(c => !addedCourses.some(a => a.code === c.code));
  }, [search, addedCourses]);

  const handleAddCourse = (course) => {
    if (!course) return;
    if (!addedCourses.some(c => c.code === course.code)) {
      setAddedCourses([...addedCourses, course]);
      setScheduleIdx(0);
      setSearch('');
      setShowSuggestions(false);
    }
  };

  // Add by typing exact code and pressing Add
  const handleAddByText = () => {
    const found = FAKE_COURSES.find(
      c => c.code.toLowerCase() === search.trim().toLowerCase()
    );
    if (found) handleAddCourse(found);
  };

  return (
    <div className="dark-root">
      <header className="header">
        <h1 className="title">Raven Planner</h1>
        <div className="subtitle">Ethan Huynh<br/>Carleton University</div>
      </header>
      <main className="main-content">
        <div className="utility-card">
          <div className="tabs">
            <button className={`tab${activeTab === 'add' ? ' active' : ''}`} onClick={() => setActiveTab('add')}>Add Course</button>
            <button className={`tab${activeTab === 'prefs' ? ' active' : ''}`} onClick={() => setActiveTab('prefs')}>Preferences</button>
            <button className={`tab${activeTab === 'schedule' ? ' active' : ''}`} onClick={() => setActiveTab('schedule')}>View Schedule</button>
          </div>
          {activeTab === 'add' && (
            <div className="course-section">
              <div className="course-label">Course Data is for Summer 2025</div>
              <div className="search-bar-container" style={{position: 'relative'}}>
                <input
                  className="search-bar"
                  type="text"
                  placeholder="Search or add course (e.g. MATH 1007)"
                  value={search}
                  onChange={e => {
                    setSearch(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAddByText();
                  }}
                />
                <button className="add-btn" onClick={handleAddByText}>Add</button>
                {showSuggestions && suggestions.length > 0 && (
                  <div className="search-results" style={{position: 'absolute', top: '110%', left: 0, right: 0, zIndex: 10}}>
                    {suggestions.map((c, idx) => (
                      <div
                        key={c.code}
                        className="search-suggestion"
                        onMouseDown={() => handleAddCourse(c)}
                      >
                        <span className="suggestion-code">{c.code}</span> <span className="suggestion-name">{c.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="added-courses-list">
                {addedCourses.length > 0 && <div className="added-title">Added Courses</div>}
                {addedCourses.map((course, idx) => (
                  <div className="added-course" key={course.code}>{course.code} - {course.name}</div>
                ))}
              </div>
            </div>
          )}
          {activeTab === 'schedule' && (
            <div className="schedule-section">
              <div className="schedule-header">
                <span className="schedule-title">Generated Schedule</span>
                <div className="schedule-controls">
                  <button className="cycle-btn" onClick={() => setScheduleIdx((scheduleIdx - 1 + schedules.length) % schedules.length)} disabled={schedules.length === 0}>⟨</button>
                  <span className="schedule-index">{schedules.length > 0 ? `Schedule ${scheduleIdx + 1} of ${schedules.length}` : 'No schedules'}</span>
                  <button className="cycle-btn" onClick={() => setScheduleIdx((scheduleIdx + 1) % schedules.length)} disabled={schedules.length === 0}>⟩</button>
                </div>
              </div>
              <div className="schedule-table-wrapper">
                <table className="schedule-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Mon</th>
                      <th>Tue</th>
                      <th>Wed</th>
                      <th>Thu</th>
                      <th>Fri</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { start: '08:35', end: '09:55' },
                      { start: '10:05', end: '11:25' },
                      { start: '11:35', end: '12:55' },
                      { start: '13:05', end: '14:25' },
                      { start: '14:35', end: '15:55' },
                      { start: '16:05', end: '17:25' },
                      { start: '18:05', end: '19:25' },
                      { start: '19:35', end: '20:55' },
                      { start: '21:00', end: '22:00' },
                    ].map(slot => (
                      <tr key={slot.start + slot.end}>
                        <td className="time-col">{slot.start} - {slot.end}</td>
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(day => {
                          const course = currentSchedule.find(c => c.day === day && c.start === slot.start && c.end === slot.end);
                          return (
                            <td key={day} className={course ? 'has-course' : ''}>
                              {course ? (
                                <div className="course-block">
                                  <span className="course-code">{course.code} {course.section}</span>
                                  <span className="course-name">{course.name}</span>
                                </div>
                              ) : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {activeTab === 'prefs' && (
            <div className="prefs-section">
              <div style={{color:'#fff8',textAlign:'center',margin:'2rem 0'}}>Preferences coming soon...</div>
            </div>
          )}
        </div>
      </main>
      <footer className="footer">
        Copyright 2024, Ethan Huynh
      </footer>
    </div>
  );
}

export default App;
