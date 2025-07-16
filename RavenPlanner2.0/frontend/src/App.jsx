import { useState, useMemo, useCallback } from 'react';
import './App.css';
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import '@fullcalendar/common/main.css';

// Course codes for search/suggestions
const COURSE_CODES = [
  { code: 'COMP 1405', name: 'Introduction to Computer Science I' },
  { code: 'MATH 1007', name: 'Elementary Calculus I' },
  // Add more course codes as needed
];

async function generateSchedule(courses) {
  try {
    const response = await fetch('http://127.0.0.1:8000/schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        numCourses: courses.length,
        requiredCourseCodes: courses.map(c => c.code),
        optionalCourseCodes: [],
        avoidProfs: [],
        avoidSections: []
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to generate schedule');
    }

    const data = await response.json();
    return data.schedules;
  } catch (error) {
    console.error('Error generating schedule:', error);
    return [];
  }
}

// Returns the day of the first Monday in the given month/year
function getFirstMonday(year, month) {
  const date = new Date(year, month, 1);
  const day = date.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = (8 - day) % 7;
  return addDays(date, diff).getDate();
}

function termToStartMonthIndexAndDay(term, year) {
  let month, day;
  switch (term.toLowerCase()) {
    case 'fall':
      month = 8; // September
      break;
    case 'winter':
      month = 0; // January
      break;
    case 'summer':
      month = 4; // May
      break;
    default:
      month = -1;
      day = -1;
      console.Error('Bad term: ', term);
      break;
  }
  if (month >= 0) {
    day = getFirstMonday(year, month);
  }

  return [month, day];
}

function termToStartDate(year, term) {
  let [month, day] = termToStartMonthIndexAndDay(term, year);

  return new Date(year, month, day);
}

function addDays(date, days) {
  var result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function meetingToDates(meeting) {
  const dates = []
  const baseDate = termToStartDate(meeting.year, meeting.term); // Guranteed to be a monday

  for(const day of meeting.days.split(' ')) {
    switch (day.toLowerCase()) {
      case 'mon':
      dates.push(addDays(baseDate, 0));
        break;
      case 'tue':
        dates.push(addDays(baseDate, 1));
        break;
      case 'wed':
        dates.push(addDays(baseDate, 2));
        break;
      case 'thu':
        dates.push(addDays(baseDate, 3));
        break;
      case 'fri':
        dates.push(addDays(baseDate, 4));
        break;
      case 'sat':
        dates.push(addDays(baseDate, 5));
        break;
      case 'sun':
        dates.push(addDays(baseDate, 6));
        break;
      default:
        break;
    }
  }

  return dates;
}

function scheduleToEvents(schedule) {
  const events = []
  for(const course of schedule) {
    for(const meeting of course.meetings) {
        const dates = meetingToDates(meeting);
        for (const date of dates) {
          const [startHour, startMinute] = meeting.start_time.split(':').map(Number);
          const startDate = new Date(date);
          startDate.setHours(startHour, startMinute, 0, 0); 

          const [endHour, endMinute] = meeting.end_time.split(':').map(Number);
          const endDate = new Date(date);
          endDate.setHours(endHour, endMinute, 0, 0); 

          events.push({
            title: `${course.course_code} ${course.section}`,
            start: startDate,
            end: endDate
          });
        }
    }
  }

  console.log(events);
  return events;
}

function renderEventContent(eventInfo) {
  const { event } = eventInfo;
  return (
    <div>
      <b>{event.title}</b>
      <div>
        {event.start && event.end
          ? `${event.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${event.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : ''}
      </div>
    </div>
  );
}

function App() {
  const [search, setSearch] = useState('');
  const [addedCourses, setAddedCourses] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeTab, setActiveTab] = useState('add');
  const [scheduleIdx, setScheduleIdx] = useState(0);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch schedules whenever added courses change
  const fetchSchedules = useCallback(async () => {
    if (addedCourses.length === 0) {
      setSchedules([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const newSchedules = await generateSchedule(addedCourses);
      
      setSchedules(newSchedules);
      setScheduleIdx(0);
    } catch (err) {
      setError('Failed to generate schedules. Please try again.');
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, [addedCourses]);

  // Trigger schedule generation when courses change
  useMemo(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const currentSchedule = schedules[scheduleIdx] || [];
  const events = useMemo(() => {
    return scheduleToEvents(currentSchedule);
  }, [currentSchedule]);

  // Filtered suggestions based on search
  const suggestions = useMemo(() => {
    if (!search.trim()) return [];
    const lower = search.toLowerCase();
    return COURSE_CODES.filter(
      c => c.code.toLowerCase().includes(lower) || c.name.toLowerCase().includes(lower)
    ).filter(c => !addedCourses.some(a => a.code === c.code));
  }, [search, addedCourses]);

  const handleAddCourse = (course) => {
    if (!course) return;
    if (!addedCourses.some(c => c.code === course.code)) {
      setAddedCourses([...addedCourses, course]);
      setSearch('');
      setShowSuggestions(false);
    }
  };

  // Add by typing exact code and pressing Add
  const handleAddByText = () => {
    const found = COURSE_CODES.find(
      c => c.code.toLowerCase() === search.trim().toLowerCase()
    );
    if (found) handleAddCourse(found);
  };

  const handleRemoveCourse = (courseCode) => {
    setAddedCourses(addedCourses.filter(c => c.code !== courseCode));
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
                {addedCourses.map((course) => (
                  <div className="added-course" key={course.code}>
                    <span>{course.code} - {course.name}</span>
                    <button 
                      className="remove-course-btn"
                      onClick={() => handleRemoveCourse(course.code)}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {activeTab === 'schedule' && (
            <div className="schedule-section">
              <div className="schedule-header">
                <span className="schedule-title">Generated Schedule</span>
                {loading ? (
                  <div className="loading-message">Generating schedules...</div>
                ) : error ? (
                  <div className="error-message">{error}</div>
                ) : (
                  <div className="schedule-controls">
                    <button 
                      className="cycle-btn" 
                      onClick={() => setScheduleIdx((scheduleIdx - 1 + schedules.length) % schedules.length)} 
                      disabled={schedules.length === 0}
                    >
                      ⟨
                    </button>
                    <span className="schedule-index">
                      {schedules.length > 0 ? `Schedule ${scheduleIdx + 1} of ${schedules.length}` : 'No schedules'}
                    </span>
                    <button 
                      className="cycle-btn" 
                      onClick={() => setScheduleIdx((scheduleIdx + 1) % schedules.length)} 
                      disabled={schedules.length === 0}
                    >
                      ⟩
                    </button>
                  </div>
                )}
              </div>
              <div className="schedule-calendar-wrapper">
                <FullCalendar
                  key={scheduleIdx}

                  plugins={[ timeGridPlugin ]}
                  initialView='timeGridWeek'
                  weekends={ false }
                  events={ events }
                  eventContent={ renderEventContent }

                  allDaySlot={ false }
                  nowIndicator={ false }

                  initialDate={ '2025-09-02' }

                  slotMinTime={ '08:30:00' }
                  slotMaxTime={ '22:30:00' }
                  slotDuration={ '00:30:00' }
                  slotLabelFormat= {{
                    hour: 'numeric',
                    minute: '2-digit',
                    omitZeroMinute: false,
                    meridiem: 'short'
                  }}
                />
              </div>
            </div>
          )}
          {activeTab === 'prefs' && (
            <div className="prefs-section">
              <div className="preferences-coming-soon">Preferences coming soon...</div>
            </div>
          )}
        </div>
      </main>
      <footer className="footer">
        Copyright 2025, Ethan Huynh
      </footer>
    </div>
  );
}

export default App;
