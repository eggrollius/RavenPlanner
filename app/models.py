from app import db

class Course(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    registration_status = db.Column(db.String(50))
    crn = db.Column(db.String(50), unique=True)
    course_code = db.Column(db.String(50))
    section = db.Column(db.String(50))
    course_name = db.Column(db.String(255))
    credits = db.Column(db.Float)
    type = db.Column(db.String(50))  # Can be 'Lecture', 'Tutorial', 'Lab' 
    instructor = db.Column(db.String(255))
    also_register_in = db.Column(db.String(255))  # To specify the additional courses or sections like "COMP 1406 B1 or B2"
    meeting_infos = db.relationship('MeetingInfo', backref='course', lazy=True, cascade="all, delete-orphan")
    term = db.Column(db.String(10), nullable=False)
    year = db.Column(db.Integer, nullable=False)   
    
class MeetingInfo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    course_id = db.Column(db.Integer, db.ForeignKey('course.id'))
    meeting_date = db.Column(db.String(50))
    days = db.Column(db.String(50))
    time = db.Column(db.String(50))
    building = db.Column(db.String(50))
    room = db.Column(db.String(50))

    def as_dict(self):
        return {
            'course_id': self.course_id,
            'meeting_date': self.meeting_date,
            'days': self.days,
            'time': self.time,
            'building': self.building,
            'room': self.room,
        }
