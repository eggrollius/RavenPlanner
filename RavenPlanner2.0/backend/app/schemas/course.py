from pydantic import BaseModel
from typing import List, Optional
from app.schemas.meeting import MeetingRead, MeetingCreate

class CourseBase(BaseModel):
    registration_status: Optional[str]
    crn: str
    course_code: str
    section: str
    course_name: str
    credits: float
    type: str
    instructor: str
    also_register_in: Optional[str]
    term: str
    year: int

class CourseCreate(CourseBase):
    meetings: List[MeetingCreate] = []

class CourseRead(CourseBase):
    meetings: List[MeetingRead] = []

    class Config:
        orm_mode = True
