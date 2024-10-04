let courseCodes = [];
let courseData = {};
let sections = {};
let schedules = [];

let userPreferences = {
    minimizeClassesBefore: null,
    minimizeClassesAfter: null,
    prioritizeDaysOff: false
};

let currentScheduleIndex = 0; // This will keep track of the current schedule index
let totalSchedules = schedules.length; // Total number of schedules (for schedule navigation)

function init(){
    //add course button
    document.getElementById("addCourseBtn").addEventListener("click", function() {
        const department = document.getElementById("department").value;
        const course_code = document.getElementById('course-code').value;
        add_course(department, course_code);
        
    });

    document.getElementById('minimizeBeforeTime').addEventListener('change', updatePreferences);
    document.getElementById('minimizeBeforeTimeCheck').addEventListener('change', updatePreferences);
    document.getElementById('minimizeAfterTime').addEventListener('change', updatePreferences);
    document.getElementById('minimizeAfterTimeCheck').addEventListener('change', updatePreferences);
    document.getElementById('prioritizeDaysOffCheck').addEventListener('change', updatePreferences);

    // Add event listeners for schedule navigation
    // For previous button
    document.getElementById('previous').addEventListener('click', function(event) {
        event.preventDefault();
        if (currentScheduleIndex > 0) {
            currentScheduleIndex--;
          renderSchedule(currentScheduleIndex);
        }
      });
    // For next butotn
    document.getElementById('next').addEventListener('click', function(event) {
    event.preventDefault();
    if (currentScheduleIndex < totalSchedules - 1) {
        currentScheduleIndex++;
        renderSchedule(currentScheduleIndex);
    }
    });
    // For direct schedule index input navigation
    document.getElementById('scheduleIndexInput').addEventListener('keypress', function(event) {
    if (event.key === 'Enter') {
        let inputIndex = parseInt(this.value, 10) - 1; // Arrays are zero-indexed
        if (inputIndex >= 0 && inputIndex < totalSchedules) {
            currentScheduleIndex = inputIndex;
        renderSchedule(currentScheduleIndex);
        } else {
        alert('Please enter a valid schedule number.');
        }
    }
    });

}

function updateCourseSelection(courseData, courseId, isSelected) {
    // Split the courseId into course code and section
    const [subject, code, section] = courseId.split(' ');
    const courseCode = subject + ' ' + code;

    if(courseData.hasOwnProperty(courseCode)) {
        const courseSections = courseData[courseCode].sections;
        for(const currentSection of Object.keys(courseSections)) {
            // Check parent course
            if(courseSections[currentSection].parent.section == section) {
                courseSections[currentSection].isSelected = isSelected;
            } else {
                // Check child courses
                for(const currentChild of courseSections[currentSection].children) {
                    if(currentChild.section == section) {
                        currentChild.isSelected = isSelected;
                    }
                }
            }
        }
    }
}


//get course data async, then update ui, and local data.
function add_course(department, course_code) {
    try{
        let courseName = department + ' ' + course_code;
        if(courseData.hasOwnProperty(courseName)) {
            alert(`Course: ${courseName}, already present.`);
            return;
        }
        
        let xhr = new XMLHttpRequest();
        xhr.open("GET", "/api/course/search?query=" + courseName, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onreadystatechange = function() {
            if(xhr.readyState == 4) {
                let data = JSON.parse(xhr.responseText);

                if(xhr.status == 200) {
                    try {
                        let sections = data["data"];
                        // Set the courses 'isSelected' property to true
                        for(let section of Object.keys(sections)) {
                            sections[section].isSelected = true;
                            for(let child of sections[section].children) {
                                child.isSelected = true;
                            }
                        }

                        courseData[courseName] = {};
                        courseData[courseName]["sections"] = {};
                        courseData[courseName]["sections"] = sections;

                        courseCodes.push(courseName); 
                        generateCourseAccordion(courseName);

                        generateSchedules();
                    } catch(e) {
                        console.log(e);
                    }
                } else if(xhr.status == 400){
                    alert(`Course: ${department +' ' + course_code}, does not Exist`);
                } else {
                    alert("Unknown Error");
                }
            }
        };

        xhr.send();
    } catch(e) {
        alert("Unknown Error");
        return;
    }
}

function generateCourseAccordion(courseName) {
    let accordion = document.getElementById("selected-courses");
    let accordionItem = document.createElement("div");
    let sanitizedCourseName = courseName.replace(/ /g, '_');
    let uniqueID = `accordion-${sanitizedCourseName}`;
    let collapseID = `collapse-${sanitizedCourseName}`;

    accordionItem.className = "accordion-item";
    accordionItem.id = uniqueID;

    accordionItem.innerHTML = `
    <h2 class="accordion-header" id="heading-${uniqueID}">
        <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseID}" aria-expanded="true" aria-controls="${collapseID}">
            ${courseName.toUpperCase()}
        </button>
    </h2>
    <div id="${collapseID}" class="accordion-collapse collapse" aria-labelledby="heading-${uniqueID}" data-bs-parent="#selected-courses">
        <div class="accordion-body">
            <!-- Cards will be inserted here -->
        </div>
    </div>`;

    if(accordion.childNodes.length <= 0) {
        accordion.appendChild(accordionItem);
    } else {
        accordion.insertBefore(accordionItem, accordion.firstChild);
    }
    new bootstrap.Collapse(document.getElementById(collapseID));

    // Add Section Cards
    for(const section of Object.keys(courseData[courseName]["sections"])) {
        addSectionCard(section, courseName);
    }
}

function addSectionCard(section, courseName) {
    const sectionObj = courseData[courseName]["sections"][section];
    let sanitizedCourseName = courseName.replace(/ /g, '_');
    let collapseID = `collapse-${sanitizedCourseName}`;
    let accordionBody = document.querySelector(`#${collapseID} .accordion-body`);

    let sectionCard = document.createElement("div");
    sectionCard.className = "card mt-2";
    const maxColsPerRow = 4;
    const colSize = 12/maxColsPerRow;

    let currentRowCount = 0;
    newHTML = `
    <div class="card-header">
        <input class="form-check-input" type="checkbox" value="" id="flexCheck-${sectionObj.parent.course_code + ' ' + section}" checked>
        <label class="form-check-label" for="flexCheckChecked">
            Section ${section} - ${sectionObj.parent.instructor}
        </label>
    </div>
    <div class="card-body">
        <div class="row">
            <div class="col-${colSize}">
                <h6><u>Lecture</u>-${section}</h6>
                <h6>Days: ${sectionObj.parent.meeting_infos[0].days}</h6>
                <p>Time: ${sectionObj.parent.meeting_infos[0].time}</p>
            </div>
    `;
    currentRowCount++;
    for(const childCourse of sectionObj.children) {
        if(currentRowCount >= maxColsPerRow) {
            newHTML += `</div><div class="row">`;
            currentRowCount = 0;
        }
        newHTML+= `
        <div class="col-${colSize}">
            <input class="form-check-input" type="checkbox" value="" id="flexCheck-${childCourse.course_code + ' ' + childCourse.section}" checked>
            <label class="form-check-label" for="flexCheckChecked">
                <h6><u>Tutorial</u>-${childCourse.section}</h6>
            </label>
            
            <h6>Days: ${childCourse.meeting_infos[0].days}</h6>
            <p>Time: ${childCourse.meeting_infos[0].time}</p>
        </div>
        `;
        currentRowCount++;
    }
    newHTML+=`</div></div>`;
    sectionCard.innerHTML = newHTML;
    
    // Loop through checkboxes and add event listeners
    sectionCard.querySelectorAll('.form-check-input').forEach((checkbox) => {
        checkbox.addEventListener('change', function() {
            const classCode = this.id.split('-')[1];
            updateCourseSelection(courseData, classCode, this.checked);
            generateSchedules();
        });
    });

    accordionBody.appendChild(sectionCard);
}

class Meeting {
    constructor(startDate, endDate, daysOfWeek, timeInterval) {
      this.startDate = new Date(startDate);
      this.endDate = new Date(endDate);
      this.daysOfWeek = daysOfWeek; // Array ['Mon', 'Thu', 'Fri']
      this.timeInterval = timeInterval; // String '14:35-15:55'
    }

    hasConflictWith(other) {
        const [start1, end1] = this.timeInterval.split(' - ');
        const [start2, end2] = other.timeInterval.split(' - ');

        if(this.startDate > other.endDate) {
            return false; 
        }
        if(this.endDate < other.startDate) {
            return false; 
        } 

        const mutualDays = this.daysOfWeek.filter(day => other.daysOfWeek.includes(day));
        if(mutualDays.length <= 0) {
            return false;
        }

        if(start1 >= end2 || end1 <= start2) {
            return false;
        }

        return true;
    }

    clone() {
        return new Meeting(
            this.startDate.toISOString(),
            this.endDate.toISOString(),
            [...this.daysOfWeek], // Shallow copy should suffice for array of strings
            this.timeInterval
        );
    }

}

class Section {
    //Section is a "combination" of parent + a child. (Child is optional)
    constructor(parent, child=null) {
        this.parent = parent;
        this.child = child;

        const parentMeetingInfo = this.parent.meeting_infos[0];

        const [parentStartDate, parentEndDate] = parentMeetingInfo.meeting_date.split(' to ');
        const parentDaysOfWeek = parentMeetingInfo.days.split(' ');

        this.meetings = [];
        this.meetings.push(new Meeting(parentStartDate, parentEndDate, parentDaysOfWeek, parentMeetingInfo.time));
        
        if (this.child) {
            const childMeetingInfo = this.child.meeting_infos[0];
            const [childStartDate, childEndDate] = childMeetingInfo.meeting_date.split(' to ');
            const childDaysOfWeek = childMeetingInfo.days.split(' ');

            const childMeeting = new Meeting(childStartDate, childEndDate, childDaysOfWeek, childMeetingInfo.time);
      
            this.meetings.push(childMeeting);
        }
      
    }

    clone() {
        return new Section(
            JSON.parse(JSON.stringify(this.parent)), // Deep copy for 'parent'
            JSON.parse(JSON.stringify(this.child)), // Deep copy for 'child'
        );
    }
}

class Schedule {
    constructor() {
        this.sections = [];
        this.meetings = [];
    }
    // Takes a section object
    tryAddSection(other) {
        if(this.meetings.length <= 0) {
            this.sections.push(other);
            this.meetings.push(...other.meetings);
            return true;
        }

        for(let i = 0; i < this.meetings.length; i++) {
            for(let j = 0; j < other.meetings.length; j++) {
                if(this.meetings[i].hasConflictWith(other.meetings[j])) {
                    return false;   
                }
            }

        }

        this.sections.push(other);
        this.meetings.push(...other.meetings);
        return true;

    }

    clone() {
        const newSchedule = new Schedule();
        newSchedule.sections = this.sections.map(section => section.clone()); // Deep copy each section
        // Ensure meetings are deep copied, assuming each 'meeting' has a clone method
        newSchedule.meetings = this.meetings.map(meeting => meeting.clone()); // Deep copy each meeting
        return newSchedule;
    }
}

function clearSchedule() {
    // List of all days in a week
    const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

    // Loop through each day and clear its contents
    daysOfWeek.forEach(day => {
        const dayColumn = document.getElementById(day);
        while(dayColumn.hasChildNodes()) {
            dayColumn.removeChild(dayColumn.firstChild);
        }
    });
}

function generateSchedules() {
    console.time("generateSchedules"); // Start timing

    for(const courseCode of courseCodes) {
        generateAllSections(courseCode);
    }

    schedules = [new Schedule()]; // Creates new list of schedules, contains 1 empty schedule
    for(const courseCode of courseCodes) { 
        // For each required course code
        currentCourseSections = sections[courseCode];
        let newSchedules = []; 
        for(const section of currentCourseSections) {
            // For each possible way of taking the course code
            let bufferSchedule;
            for(const schedule of schedules) {
                // For each old schedule
                // Make a new schedule by adding each possible way of taking the course
                bufferSchedule = schedule.clone();
                if(bufferSchedule.tryAddSection(section)) {
                    // If no conflict
                    newSchedules.push(bufferSchedule);
                    //console.log('no conflict found');
                } else {
                    // Conflict
                    //console.log(`Conflict found with: ${courseCode + section.parent.section} and this schedule:`);
                    //console.log(bufferSchedule);
                }
                //console.log(newSchedules.length);
            }
        }
        if(newSchedules.length > 0) {
            schedules = newSchedules;
        } else {
            console.log(`Could not add this course: ${courseCode}`);
        }
        
    }

    totalSchedules = schedules.length;

    console.timeEnd("generateSchedules"); // Stop timing and print the result

    rateSchedules();
    renderSchedule(currentScheduleIndex);
}

function rateSchedules() {
    console.time("rateSchedules");
    let ratedSchedules = schedules.map(schedule => {
        return {
            schedule: schedule,
            rating: rateSchedule(schedule)
        };
    });
    
    // Sort the rated schedules array based on the ratings
    ratedSchedules.sort((a, b) => b.rating - a.rating);
    
    // Extract the sorted schedules
    schedules = ratedSchedules.map(item => item.schedule);

    console.timeEnd("rateSchedules");
}

function rateSchedule(schedule) {
    let rating = 0;
    if(userPreferences.minimizeClassesBefore) {
        rating -= 1.5 * countClassesBefore(schedule, userPreferences.minimizeClassesBefore)
    }
    if(userPreferences.minimizeClassesAfter) {
        rating -= 1.5 * countClassesAfter(schedule, userPreferences.minimizeClassesAfter)
    }
    if(userPreferences.prioritizeDaysOff) {
        rating += 1 * countDaysOff(schedule);
    }
    // console.log(rating);
    return rating;
}

function countDaysOff(schedule) {
    let scheduleDays = new Set(); // A set of days that this schedule has classes on.
    for(const meeting of schedule.meetings) {
        meeting.daysOfWeek.forEach(day => {
            scheduleDays.add(day);
        });
    }

    return 5 - scheduleDays.size;
}

function countClassesBefore(schedule, time) {
    let count = 0;
    const compareTime = timeToMinutes(time);

    for(const meeting of schedule.meetings) {
        // Extract start time from the meeting's time interval
        const meetingStartTimeMinutes = timeToMinutes(meeting.timeInterval.split(' - ')[0]);
        // Compare meeting start time with given time
        if(meetingStartTimeMinutes < compareTime) {
            count += meeting.daysOfWeek.length;
        }
    }

    return count;
}

function countClassesAfter(schedule, time) {
    let count = 0;
    const compareTime = timeToMinutes(time);
    for(const meeting of schedule.meetings) {
        // Extract start time from the meeting's time interval
        const meetingEndMinutes = timeToMinutes(meeting.timeInterval.split(' - ')[1]);
        // Compare meeting start time with given time
        if(meetingEndMinutes > compareTime) {
            count += meeting.daysOfWeek.length;
        }
    }

    return count;
}

// Helper function to convert HH:MM time string to minutes since midnight
function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

function renderSchedule(scheduleIndex){
    // Clear old schedule
    clearSchedule();
    //Set the placholder to the start index
    let scheduleIndexInput = document.getElementById('scheduleIndexInput');
    scheduleIndexInput.setAttribute('placeholder', scheduleIndex+1);

    // Iterate over the schedule and update the calendar cells
    let schedule;
    schedule = schedules[scheduleIndex];
    schedule.sections.forEach(section => {
        // Do parent class first:
        let c = section.parent; // c for 'class' (class is restricted variable name)
        let meeting = c.meeting_infos[0];
        let [startTime, endTime]  = meeting.time.split(' - ')
        let days = meeting.days.split(' ');
        days.forEach(day => {
            // Get column for this day
            const dayColumn = document.getElementById(day);
            // Create and add block for this class
            const classBlock = document.createElement('div');
            classBlock.classList.add('class-block', 'shadow-lg', 'rounded');
            classBlock.innerHTML = `                
                ${c.course_code + ' ' + c.section}
                <div class="popup-box">
                    Course Code: ${c.course_code} <br>
                    Meeting Time: ${meeting.time}
                </div>
            `;


            classBlock.style.top = timeToPixels(startTime) + 'px';
            classBlock.style.height = durationToPixels(startTime, endTime) + 'px';
            dayColumn.appendChild(classBlock);
        });

        // Do child class now:
        if(section.child != null){
            c = section.child; // c for 'class' (class is restricted variable name)
            meeting = c.meeting_infos[0];
            [startTime, endTime]  = meeting.time.split(' - ')
            days = meeting.days.split(' ');
            days.forEach(day => {
                // Get column for this day
                const dayColumn = document.getElementById(day);
                // Create and add block for this class
                const classBlock = document.createElement('div');
                classBlock.classList.add('class-block');
                classBlock.innerHTML = `
                ${c.course_code + ' ' + c.section}
                    <div class="popup-box">
                        Course Code: ${c.course_code} <br>
                        Meeting Time: ${meeting.time}
                    </div>
                `;
    
                classBlock.style.top = timeToPixels(startTime) + 'px';
                classBlock.style.height = durationToPixels(startTime, endTime) + 'px';
                dayColumn.appendChild(classBlock);
            });
        }
    });
}

function generateAllSections(courseCode) {
    const course = courseData[courseCode];
    const courseSections = course.sections;

    sections[courseCode] = [];

    for(const sectionName of Object.keys(courseSections)) {
        const section = courseSections[sectionName];
        if(section.isSelected) {
            if(section.children.length <= 0) {
                const newSection = new Section(section.parent);
                sections[courseCode].push(newSection);
            } else {
                for(const child of section.children) {
                    if(child.isSelected) {
                        const newSection = new Section(section.parent, child);
                        sections[courseCode].push(newSection);
                    }

                }
            }
        }
    }
}

// Function to convert time ("HH:MM") to pixels
function timeToPixels(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return (hours + minutes / 60 - 7) * 50; // 50 pixels per hour, adjust the -7 based on start of time column
}

// Function to calculate the duration in pixels
function durationToPixels(startTime, endTime) {
    const startTimeInPixels = timeToPixels(startTime);
    const endTimeInPixels = timeToPixels(endTime);
    return endTimeInPixels - startTimeInPixels;
}

function updatePreferences() {
    const minimizeBeforeCheck = document.getElementById('minimizeBeforeTimeCheck');
    const minimizeBeforeSelect = document.getElementById('minimizeBeforeTime');
    const minimizeAfterCheck = document.getElementById('minimizeAfterTimeCheck');
    const minimizeAfterSelect = document.getElementById('minimizeAfterTime');
    const prioritizeDaysOffCheckbox = document.getElementById('prioritizeDaysOffCheck');

    if(minimizeBeforeCheck.checked) {
        userPreferences.minimizeClassesBefore = minimizeBeforeSelect.value;
    } else {
        userPreferences.minimizeClassesBefore = null;
    }
    if(minimizeAfterCheck.checked) {
        userPreferences.minimizeClassesAfter = minimizeAfterSelect.value;
    } else {
        userPreferences.minimizeClassesAfter = null;
    }
   
    userPreferences.prioritizeDaysOff = prioritizeDaysOffCheckbox.checked;

    rateSchedules();
    renderSchedule(currentScheduleIndex);
}

init();