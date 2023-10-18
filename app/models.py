from app import db

class Course(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    registration_status = db.Column(db.String(50))
    crn = db.Column(db.String(50), unique=True)
    course_code = db.Column(db.String(50))
    section = db.Column(db.String(50))
    course_name = db.Column(db.String(255))
    credits = db.Column(db.Float)
    type = db.Column(db.String(50))
    lab_required = db.Column(db.Boolean)
    tutorial_required = db.Column(db.Boolean)
    instructor = db.Column(db.String(255))
    # Add any other fields here

class MeetingInfo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    course_id = db.Column(db.Integer, db.ForeignKey('course.id'))
    meeting_date = db.Column(db.String(50))
    days = db.Column(db.String(50))
    time = db.Column(db.String(50))
    building = db.Column(db.String(50))
    room = db.Column(db.String(50))

class SectionInfo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    course_id = db.Column(db.Integer, db.ForeignKey('course.id'))
    section_type = db.Column(db.String(50))
    notes = db.Column(db.Text)
    # Add any other fields here
