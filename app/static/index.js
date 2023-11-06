let departments = [];
let courseCodes = [];
let courseData = {};
let sections = {};
let schedules = [];

let currentScheduleIndex = 0; // This will keep track of the current schedule index
let totalSchedules = 1000; // Total number of schedules (for schedule navigation)

function init(){
    //add the departments
    departments = ["MATH", "COMP", "STAT", "ECOR"];
    let department_select = document.getElementById("department");
    let inner_HTML = '';
    if(department_select) {
        for(let department of departments) {
            inner_HTML += `<option value="${department}">${department}</option>`;
        }
        department_select.innerHTML = inner_HTML;
    }

    //course code

    //add course button
    document.getElementById("addCourseBtn").addEventListener("click", function() {
        const department = document.getElementById("department").value;
        const course_code = document.getElementById('course-code').value;
        add_course(department, course_code);
        
    });

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
    // For direct schedule index input navigatoin
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

//get course data async, then update ui, and local data.
function add_course(department, course_code) {
    try{
        let courseName = department + ' ' + course_code;
        let xhr = new XMLHttpRequest();
        xhr.open("GET", "/api/course/search?query=" + courseName, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onreadystatechange = function() {
            if(xhr.readyState == 4) {
                try {
                    let data = JSON.parse(xhr.responseText);

                    if(xhr.status == 200) {
                        courseData[courseName] = {};
                        courseData[courseName]["sections"] = data["data"];
                        courseCodes.push(courseName); 
                        generateCourseAccordion(courseName);
                        generateSchedules();
                        renderSchedule(currentScheduleIndex);
                    } else if(xhr.status == 400){
                        alert("Course does not Exist");
                    } else {
                        alert("Unknown Error");
                    }
                } catch (e) {
                    console.log(e);
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
            ${courseName}
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
    for(section of Object.keys(courseData[courseName]["sections"])) {
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
        <input class="form-check-input" type="checkbox" value="" id="flexCheck-${sectionObj.parent.course_code + section}" checked>
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
            <input class="form-check-input" type="checkbox" value="" id="flexCheck-${childCourse.course_code + childCourse.section}" checked>
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
            if(this.id == `flexCheck-${sectionObj.parent.course_code + section}`) {
                //TODO
            } else {
                //TODO
            }
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
    const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Loop through each day and clear its contents
    daysOfWeek.forEach(day => {
        const dayColumn = document.getElementById(day);
        while (dayColumn.hasChildNodes()) {
            dayColumn.removeChild(dayColumn.firstChild);
        }
    });
}

function generateSchedules() {
    for(const courseCode of courseCodes) {
        generateAllSections(courseCode);
    }
    console.log(sections);

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
                    console.log('no conflict found');
                } else {
                    // Conflict
                    console.log(`Conflict found with: ${courseCode + section.parent.section} and this schedule:`);
                    console.log(bufferSchedule);
                }
                console.log(newSchedules.length);
            }
        }
        if(newSchedules.length > 0) {
            schedules = newSchedules;
        } else {
            console.log(`Could not add this course: ${courseCode}`);
        }
        
    }

    totalSchedules = schedules.length;
    console.log(schedules)
}



function renderSchedule(scheduleIndex){
    // Clear old schedule
    clearSchedule();
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
            classBlock.classList.add('class-block');
            classBlock.innerHTML = `${c.course_code + ' ' + c.section}<br>${meeting.time}`;


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
                classBlock.innerHTML = `${c.course_code + ' ' + c.section}<br>${meeting.time}`;

    
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
        if(section.children.length <= 0) {
            const newSection = new Section(section.parent);
            sections[course.courseName].append(newSection);
        } else {
            for(const child of section.children) {
                const newSection = new Section(section.parent, child);
                sections[courseCode].push(newSection);
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
init();