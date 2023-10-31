let departments = [];
let courseCodes = [];
let courseData = {};
let sections = [];
let schedules = [];

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

    mergeWith(other) {
        if (this.hasConflictWith(other)) {
          throw new Error('Cannot merge conflicting TimeObjects');
        }
    
        const newStartDate = this.startDate < other.startDate ? this.startDate : other.startDate;
        const newEndDate = this.endDate > other.endDate ? this.endDate : other.endDate;
    
        const newDaysOfWeek = Array.from(new Set([...this.daysOfWeek, ...other.daysOfWeek]));
    
        const [start1, end1] = this.timeInterval.split('-');
        const [start2, end2] = other.timeInterval.split('-');
        const newStart = start1 < start2 ? start1 : start2;
        const newEnd = end1 > end2 ? end1 : end2;
    
        const newTimeInterval = `${newStart}-${newEnd}`;
    
        return new Meeting(newStartDate, newEndDate, newDaysOfWeek, newTimeInterval);
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

        this.meeting = new Meeting(parentStartDate, parentEndDate, parentDaysOfWeek, parentMeetingInfo.time);
        
        if (this.child) {
            const childMeetingInfo = this.child.meeting_infos[0];
            const [childStartDate, childEndDate] = childMeetingInfo.meeting_date.split(' to ');
            const childDaysOfWeek = childMeetingInfo.days.split(' ');

            const childMeeting = new Meeting(childStartDate, childEndDate, childDaysOfWeek, childMeetingInfo.time);
      
            this.meeting = this.meeting.mergeWith(childMeeting);
        }
      
    }
}

class schedule {
    constructor() {
        this.sections = [];
        this.meeting = null;
    }

    tryAddSection(other) {
        if(!this.meeting.hasConflictWith(other.meeting)) {
            this.sections.push(other);
            this.meeting = this.meeting.mergeWith(other);
            return true;
        } else {
            return false;
        }

    }
}

function generateSchedules() {
    for(const courseCode of courseCodes) {
        generateAllSections(courseData[courseCode]);
    }
}

function generateAllSections(course) {
    const courseSections = course.sections;
    console.log(courseSections);
    for(const sectionName of Object.keys(courseSections)) {
        const section = courseSections[sectionName];
        console.log(section);
        if(section.children.length <= 0) {
            const newSection = new Section(section.parent);
            sections.append(newSection);
        } else {
            for(const child of section.children) {
                const newSection = new Section(section.parent, child);
                sections.push(newSection);
            }
        }
    }
    console.log(sections);
}

init();