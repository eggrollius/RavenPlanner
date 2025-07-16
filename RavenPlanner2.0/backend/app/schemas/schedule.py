from typing import List
from pydantic import BaseModel
from app.schemas.course import CourseRead

class ScheduleResponse(BaseModel):
    schedule: List[CourseRead]
