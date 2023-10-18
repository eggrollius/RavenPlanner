from flask import Blueprint, request, jsonify
from app.models import Course
from app.models import MeetingInfo
from app import db

from sqlalchemy.exc import IntegrityError #excpetion

api = Blueprint('api', __name__)

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


@api.route('/course/<id>', methods=['PUT'])
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


@api.route('/course/<id>', methods=['DELETE'])
def delete_course(id):
    course = Course.query.get(id)
    if not course:
        return jsonify({'message': 'Course not found'})
        
    db.session.delete(course)
    db.session.commit()
    return jsonify({'message': 'Course deleted'})