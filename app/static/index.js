let departments = [];
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
    document.getElementById("add-course").addEventListener("click", function(){
        const department = document.getElementById("department").value;
        const course_code = document.getElementById('course-code').value;
        add_course(department, course_code)
    });
}

function add_course(department, course_code){
    let ul = document.getElementById("selected-courses");
    let li = document.createElement("li");
    li.innerText = department + ' ' + course_code;

    ul.insertBefore(li, ul.firstChild); //insert it first, so it appears at top
}

init();