from flask import Blueprint, request, jsonify
from app.models import Course
from app.models import MeetingInfo
from app import db
from copy import deepcopy, copy

from datetime import datetime, time
from dateutil.rrule import rrule, DAILY
from typing import List, Dict

from sqlalchemy import text
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError #excpetion

api = Blueprint('api', __name__)
#create a new course
@api.route('/course', methods=['POST'])
def add_course():
    data = request.get_json()
    new_course = Course(
        registration_status=data['registration_status'],
        crn=data['crn'],
        course_code=data['course_code'],
        section=data['section'],
        course_name=data['course_name'],
        credits=data['credits'],
        type=data['type'],
        instructor=data['instructor'],
        also_register_in=data['also_register_in']
    )
    db.session.add(new_course)
    db.session.flush() # this makes the new course have a primary key, that i will associate to the meeting info obejct

    #for each different meeting time of the course
    meeting_info = data['meeting_infos']
    new_meeting_info = MeetingInfo(
        course_id=new_course.id,
        meeting_date=meeting_info['meeting_date'],
        days=meeting_info['days'],
        time=meeting_info['time'],
        building=meeting_info['building'],
        room=meeting_info['room']
    )
    db.session.add(new_meeting_info)
    try:
        db.session.commit()
        return jsonify({'message': 'New course added'})
    except IntegrityError:
        #handle duplicate records
        db.session.rollback();
        return jsonify({'message': 'CRN already exists, duplicate'}); 

#get all courses
@api.route('/courses', methods=['GET'])
def get_courses():
    # Only get courses for the current term and year
    course_list = Course.query.filter_by(term='SUMMER', year=2025).all()
    courses = []
    count = 0
    for course in course_list:
        meeting_infos = MeetingInfo.query.filter_by(course_id=course.id).all()
        meetings = []
        for meeting_info in meeting_infos:
            meetings.append({
                'meeting_date': meeting_info.meeting_date,
                'days': meeting_info.days,
                'time': meeting_info.time,
                'building': meeting_info.building,
                'room': meeting_info.room
            })

        courses.append({
            'registration_status': course.registration_status,
            'crn': course.crn,
            'course_code': course.course_code,
            'section': course.section,
            'course_name': course.course_name,
            'credits': course.credits,
            'type': course.type,
            'instructor': course.instructor,
            'also_register_in': course.also_register_in,
            'meetings': meetings  # Including the meetings information here
        })
        count += 1
    print(count)
    return jsonify({'courses': courses})

#Search courses by name
@api.route('/course/search', methods=['GET'])
def search_course():
    query = request.args.get('query', '').upper()
    # Only search in current term and year
    courses = Course.query.filter(Course.course_code == query, Course.term == 'SUMMER', Course.year == 2025).all()
    if not courses:
        # No courses found, return a 400 response
        return jsonify({"status": "error", "message": "No course found matching the query"}), 400

    course_sections = {};
    #first find parent courses and the name of the sections
    for course in courses:
        section = course.section
        
        # Check if the course is a parent course (section has only one letter)
        if len(section) == 1:
            if section not in course_sections:
                course_sections[section] = {}
            course_sections[section]["parent"] = course_to_dict(course);
            course_sections[section]["children"] = []; #prepare an empty list

    # Loop again to find child courses for each parent
    for section in course_sections:
        for course in courses:
        # Check if the course is a child course (section has more than one letter)
            if len(course.section) > 1:
                if(course.section[0] == section):
                    course_sections[section]["children"].append(course_to_dict(course))

    return jsonify({"status":"success", "message":"succesfuly searched for course", "data":course_sections})

def course_to_dict(course):
    return {
        'id': course.id,
        'registration_status': course.registration_status,
        'crn': course.crn,
        'course_code': course.course_code,
        'section': course.section,
        'course_name': course.course_name,
        'credits': course.credits,
        'type': course.type,
        'also_register_in': course.also_register_in,
        'instructor': course.instructor,
        'meeting_infos': [info.as_dict() for info in course.meeting_infos]
    }

#check existence of class by crn
@api.route('/course/exists/<crn>', methods=['GET'])
def check_course_exists_by_crn(crn):
    # Only check for current term and year
    course = Course.query.filter_by(crn=crn, term='SUMMER', year=2025).first()
    if course:
        return jsonify({'message': 'Course exists', 'exists': True})
    else:
        return jsonify({'message': 'Course does not exist', 'exists': False})

#update by crn
@api.route('/course/crn/<crn>', methods=['PUT'])
def update_course_by_crn(crn):
    # Only update if course is in current term and year
    course = Course.query.filter_by(crn=crn, term='SUMMER', year=2025).first()
    if not course:
        return jsonify({'message': 'Course not found'})

    data = request.get_json()

    # Update the course fields with new data
    course.registration_status = data.get('registration_status', course.registration_status)
    course.course_code = data.get('course_code', course.course_code)
    course.section = data.get('section', course.section)
    course.course_name = data.get('course_name', course.course_name)
    course.credits = data.get('credits', course.credits)
    course.type = data.get('type', course.type)
    course.instructor = data.get('instructor', course.instructor)
    course.also_register_in = data.get('also_register_in', course.also_register_in)

    # Update MeetingInfo record if it is provided in request data
    new_meeting_info = data.get('meeting_infos', None)
    if new_meeting_info is not None:
        # First, delete existing MeetingInfo entries
        MeetingInfo.query.filter_by(course_id=course.id).delete()

        # Then, add a new MeetingInfo entry
        new_meeting_info_entry = MeetingInfo(
            course_id=course.id,
            meeting_date=new_meeting_info.get('meeting_date', ''),
            days=new_meeting_info.get('days', ''),
            time=new_meeting_info.get('time', ''),
            building=new_meeting_info.get('building', ''),
            room=new_meeting_info.get('room', '')
        )
        db.session.add(new_meeting_info_entry)

    db.session.commit()
    return jsonify({'message': 'Course and meeting info updated'})

#delete by unique CRN
@api.route('/course/crn/<crn>', methods=['DELETE'])
def delete_course_by_crn(crn):
    # Only delete if course is in current term and year
    course = Course.query.filter_by(crn=crn, term='SUMMER', year=2025).first()
    if not course:
        return jsonify({'message': 'Course not found'})

    # Delete all related MeetingInfo entries
    MeetingInfo.query.filter_by(course_id=course.id).delete()

    db.session.delete(course)
    db.session.commit()
    return jsonify({'message': 'Course deleted'})


#delete by primary key(id)
@api.route('/course/<id>', methods=['DELETE'])
def delete_course(id):
    course = Course.query.get(id)
    # Only delete if course is in current term and year
    if not course or course.term != 'SUMMER' or course.year != 2025:
        return jsonify({'message': 'Course not found'})

    # Delete all related MeetingInfo entries
    MeetingInfo.query.filter_by(course_id=course.id).delete()

    db.session.delete(course)
    db.session.commit()
    return jsonify({'message': 'Course deleted'})

from datetime import datetime, time, date
from dateutil.rrule import rrule, DAILY
from typing import List

class SimpleDateTimeRange:
    def __init__(self, start_date, end_date, days_of_week, start_time, end_time):
        self.start_date = datetime.strptime(start_date, '%b %d, %Y').date() if start_date else None
        self.end_date = datetime.strptime(end_date, '%b %d, %Y').date() if end_date else None
        self.days_of_week = days_of_week  # list of integers [0(Sunday), 1(Monday), ... , 6(Saturday)]
        self.start_time = datetime.strptime(start_time, '%H:%M').time() if start_time else None
        self.end_time = datetime.strptime(end_time, '%H:%M').time() if end_time else None

class DateTimeRange:
    def __init__(self):
        self.ranges: List[SimpleDateTimeRange] = []

    def add_range(self, start_date=None, end_date=None, days_of_week=None, start_time=None, end_time=None, 
                  simple_range: SimpleDateTimeRange = None):
        if simple_range:
            new_range = simple_range
        else:
            new_range = SimpleDateTimeRange(start_date, end_date, days_of_week, start_time, end_time)
        self.ranges.append(new_range)

    def overlaps(self, other):
        for r1 in self.ranges:
            for r2 in other.ranges:
                if self._single_overlap(r1, r2):
                    return True
        return False

    def _single_overlap(self, r1, r2):
        if not r1.start_date or not r2.start_date:
            return False
        if r1.start_date > r2.end_date or r1.end_date < r2.start_date:
            return False
        if not set(r1.days_of_week).intersection(r2.days_of_week):
            return False
        if r1.start_time > r2.end_time or r1.end_time < r2.start_time:
            return False
        for dt in rrule(DAILY, dtstart=datetime.combine(r1.start_date, time()), until=datetime.combine(r1.end_date, time())):
            if dt.weekday() in r1.days_of_week:
                for other_dt in rrule(DAILY, dtstart=datetime.combine(r2.start_date, time()), until=datetime.combine(r2.end_date, time())):
                    if other_dt.weekday() in r2.days_of_week and dt.date() == other_dt.date():
                        return True
        return False

def create_date_time_range_from_meetings(meetings: List[MeetingInfo]) -> DateTimeRange:
    date_time_range = DateTimeRange()

    for meeting in meetings:
        if hasattr(meeting, 'meeting_date'):
            start_date, end_date = meeting.meeting_date.split(' to ')
        else:
            start_date, end_date = None, None  # Or some default value

        if hasattr(meeting, 'days'):
            days_of_week = meeting.days
        else:
            days_of_week = ''  # Default value

        if hasattr(meeting, 'time'):
            time_parts = meeting.time.split(' - ')
            if len(time_parts) == 2:
                start_time, end_time = time_parts
            else:
                start_time, end_time = None, None  # Or some default value
        else:
            start_time, end_time = None, None  # Or some default value

        date_time_range.add_range(start_date=start_date.strip() if start_date else None,
                                  end_date=end_date.strip() if end_date else None,
                                  days_of_week=days_of_week.strip() if days_of_week else None,
                                  start_time=start_time.strip() if start_time else None,
                                  end_time=end_time.strip() if end_time else None)

    return date_time_range

class Section:
    def __init__(self, course: Course, date_time: DateTimeRange, *args, **kwargs):
        self.course = course
        self.date_time = date_time
        self.child_class = kwargs.get('child_class', None)

class Schedule:
    def __init__(self):
        self.date_time = None
        self.sections = []
    def try_add_section(self, section: Section) -> bool:
        if self.date_time is None:
            self.sections.append(section)
            return True

        if(self.date_time.overlaps(section.date_time) and self.date_time.overlaps(section.child_class.date_time)):
            self.sections.append(section)
            self.date_time.add_range(simple_range=section.date_time)
            return True
        else:
            return False
    def deep_copy(self):
        return deepcopy(self)
    def shallow_copy(self):
        return copy(self)


@api.route('/generate_schedule', methods=['POST'])
def generate_schedule():
    #timing for testing
    import time
    start_time = time.time()

    data = request.get_json()
    required_courses_codes = data["required_courses_codes"]
    # Query for all Course objects where course_code is in course_codes_list
    courses = (
        Course.query
        .filter(Course.course_code.in_(required_courses_codes))
        .filter(Course.section.op('~')('^[A-Za-z]+$'))
        .all()
    )
    #print(courses)
    # Iterate through the results to get the 'also_register_in' field for each course and make a section object
    courses_sections = {}
    for course in courses:
        sections = []
        if course.also_register_in:
            # if the course has some child courses
            # Split comma-separated course codes into a list
            also_register_codes = course.also_register_in.split(',')
            #print(f"The course called: {course.course_name} has these child courses: {also_register_codes}")
            # Remove leading and trailing whitespace from each code
            also_register_codes = [code.strip() for code in also_register_codes]

            parent_date_time = create_date_time_range_from_meetings(course.meeting_infos)
            for child_code in also_register_codes:
                child = Course.query.filter(func.concat(Course.course_code, ' ', Course.section) == child_code).first()
                child_date_time = create_date_time_range_from_meetings(child.meeting_infos)
                child_section = Section(child, child_date_time)

                sections.append(Section(course, parent_date_time, child_class=child_section))
                
        else:
            #if the course is a standalone
            parent_date_time = create_date_time_range_from_meetings(course.meeting_infos)
            sections.append(Section(course, parent_date_time))
        if course.course_code in courses_sections:
            courses_sections[course.course_code].extend(sections)
        else:
            courses_sections[course.course_code] = sections

    
    #now generate the schedules
    schedules = [Schedule()]
    for course_code in required_courses_codes:
        sections_to_add = courses_sections[course_code]
        schedules_buffer = []
        for section in sections_to_add:
            for schedule in schedules:
                buffer_schedule = schedule.deep_copy()
                if buffer_schedule.try_add_section(section):
                    #if no conflict
                    schedules_buffer.append(buffer_schedule)
        schedules = schedules_buffer

    # Prepare the final data structure
    final_schedules = []

    for schedule in schedules:
        schedule_dict = {
            'sections': []
        }

        for section in schedule.sections:
            section_dict = {
                'crn': section.course.crn,
                'course_code': section.course.course_code,  
                'section': section.course.section,
                'course_name': section.course.course_name,  
                'instructor': section.course.instructor,  
                'credits': section.course.credits,  
                'type': section.course.type,  
                'date_time_ranges': section.course.meeting_infos[0].as_dict()
            }
            if section.child_class:
                section_dict['child_sections'] = [
                    {
                        'crn': section.child_class.course.crn,
                        'course_code': section.child_class.course.course_code,  
                        'section': section.child_class.course.section,
                        'course_name': section.child_class.course.course_name,  
                        'instructor': section.child_class.course.instructor, 
                        'credits': section.child_class.course.credits, 
                        'type': section.child_class.course.type, 
                        'date_time_ranges': section.child_class.course.meeting_infos[0].as_dict()  # Assuming you have a to_dict() in your DateTimeRange class
                    }
                ]
            schedule_dict['sections'].append(section_dict)
        
        final_schedules.append(schedule_dict)

    response = {
        'status': 'success',
        'message': 'Schedule generated',
        'data': {
            'schedules': final_schedules
        }
    }

    end_time = time.time()
    elapsed_time = end_time - start_time
    print(f"API call took {elapsed_time} seconds")
    return jsonify(response), 200, {'Content-Type': 'application/json'}