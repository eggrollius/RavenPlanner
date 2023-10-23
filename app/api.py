from flask import Blueprint, request, jsonify
from app.models import Course
from app.models import MeetingInfo
from app import db

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
    for meeting_info in data['meeting_infos']:
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
    course_list = Course.query.all()
    courses = []

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

    return jsonify({'courses': courses})

#Search courses by name
@api.route('/course/search', methods=['GET'])
def search_course():
    query = request.args.get('query', '')
    courses = Course.query.filter(Course.course_code.ilike(f'%{query}%')).all()

    course_list = []
    for course in courses:
        meeting_infos = []
        for meeting_info in course.meeting_infos:
            meeting_infos.append({
                'meeting_date': meeting_info.meeting_date,
                'days': meeting_info.days,
                'time': meeting_info.time,
                'building': meeting_info.building,
                'room': meeting_info.room
            })

        course_list.append({
            'id': course.id,
            'registration_status': course.registration_status,
            'crn': course.crn,
            'course_code': course.course_code,
            'section': course.section,
            'course_name': course.course_name,
            'credits': course.credits,
            'type': course.type,
            'instructor': course.instructor,
            'also_register_in': course.also_register_in,
            'meeting_infos': meeting_infos
        })

    return jsonify({'courses': course_list})

#check existence of class by crn
@api.route('/course/exists/<crn>', methods=['GET'])
def check_course_exists_by_crn(crn):
    course = Course.query.filter_by(crn=crn).first()
    if course:
        return jsonify({'message': 'Course exists', 'exists': True})
    else:
        return jsonify({'message': 'Course does not exist', 'exists': False})
#update by id
@api.route('/course/<crn>', methods=['PUT'])
def update_course(id):
    course = Course.query.get(id)
    if not course:
        return jsonify({'message': 'Course not found'})
        
    data = request.get_json()

    course.registration_status = data['registration_status']
    course.crn = data['crn']
    course.course_code = data['course_code']
    course.section = data['section']
    course.course_name = data['course_name']
    course.credits = data['credits']
    course.type = data['type']
    course.instructor = data['instructor']
    course.also_register_in = data['also_register_in']

    db.session.commit()
    return jsonify({'message': 'Course updated'})

#update by crn
@api.route('/course/crn/<crn>', methods=['PUT'])
def update_course_by_crn(crn):
    course = Course.query.filter_by(crn=crn).first()
    if not course:
        return jsonify({'message': 'Course not found'})

    data = request.get_json()

    # Update the course fields with new data
    course.registration_status = data.get('registration_status', course.registration_status)
    #course.crn = data.get('crn', course.crn) #possibly conflicting
    course.course_code = data.get('course_code', course.course_code)
    course.section = data.get('section', course.section)
    course.course_name = data.get('course_name', course.course_name)
    course.credits = data.get('credits', course.credits)
    course.type = data.get('type', course.type)
    course.instructor = data.get('instructor', course.instructor)
    course.also_register_in = data.get('also_register_in', course.also_register_in)

    db.session.commit()
    return jsonify({'message': 'Course updated'})

#delete by unique CRN
@api.route('/course/crn/<crn>', methods=['DELETE'])
def delete_course_by_crn(crn):
    course = Course.query.filter_by(crn=crn).first()
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
    if not course:
        return jsonify({'message': 'Course not found'})

    # Delete all related MeetingInfo entries
    MeetingInfo.query.filter_by(course_id=course.id).delete()

    db.session.delete(course)
    db.session.commit()
    return jsonify({'message': 'Course deleted'})
