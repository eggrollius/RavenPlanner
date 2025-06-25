from sqlalchemy import Column, String, Integer, ForeignKeyConstraint
from sqlalchemy.orm import relationship
from app.db.session import Base

class Meeting(Base):
    __tablename__ = "meeting"

    crn = Column(String(50), primary_key=True)
    term = Column(String(10), primary_key=True)
    year = Column(Integer, primary_key=True)

    meeting_date = Column(String(50))
    days = Column(String(50))
    time = Column(String(50))
    building = Column(String(50))
    room = Column(String(50))

    course = relationship("Course", back_populates="meetings")

    __table_args__ = (
        ForeignKeyConstraint(
            ['crn', 'term', 'year'],
            ['course.crn', 'course.term', 'course.year'],
            name="meeting_course_fk"
        ),
    )
