from pydantic import BaseModel
from typing import List
from app.schemas.course import CourseRead  # import your existing course response schema

class ScheduleResponse(BaseModel):
    schedules: List[List[CourseRead]]
