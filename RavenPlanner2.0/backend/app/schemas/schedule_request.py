from pydantic import BaseModel
from typing import List

class ScheduleRequest(BaseModel):
    numCourses: int
    requiredCourseCodes: List[str]
    optionalCourseCodes: List[str] = []             # implement later
    avoidProfs: List[str] = []                      # implement later
    avoidSections: List[str] = []                   
