from pydantic import BaseModel

class MeetingBase(BaseModel):
    meeting_date: str
    days: str
    time: str
    building: str
    room: str

class MeetingCreate(MeetingBase):
    pass

class MeetingRead(MeetingBase):
    id: int
    course_id: int

    class Config:
        orm_mode = True
