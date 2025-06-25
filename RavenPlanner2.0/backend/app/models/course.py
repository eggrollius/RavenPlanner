from sqlalchemy import Column, Integer, String, Float, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db.session import Base

class Course(Base):
    __tablename__ = "course"

    crn = Column(String(50), primary_key=True)
    term = Column(String(10), primary_key=True)
    year = Column(Integer, primary_key=True)

    registration_status = Column(String(50))
    course_code = Column(String(50))
    section = Column(String(50))
    course_name = Column(String(255))
    credits = Column(Float)
    type = Column(String(50))
    instructor = Column(String(255))
    also_register_in = Column(String(255))


    meetings = relationship(
        "Meeting",
        back_populates="course",
        cascade="all, delete-orphan"
    )