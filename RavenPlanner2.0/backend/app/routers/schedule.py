from fastapi import APIRouter, HTTPException
from app.schemas.schedule_request import ScheduleRequest
from app.schemas.schedule_response import ScheduleResponse
from app.services.schedule_service import ScheduleService

router = APIRouter()

@router.post("/schedule", response_model=ScheduleResponse)
def generate_schedule(payload: ScheduleRequest):
    result = ScheduleService.get_schedule(
        required_course_codes=payload.requiredCourseCodes,
        number_of_courses=payload.numCourses,
        avoid_sections=payload.avoidSections
        # Optional fields will be passed in later
    )

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return {"schedules": result["schedules"]}
