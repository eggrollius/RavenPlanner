from pydantic import BaseModel, ConfigDict

class Meeting(BaseModel):
    meeting_date: str
    days: str
    time: str
    building: str
    room: str

class MeetingCreate(Meeting):
    pass

class MeetingRead(BaseModel):
    crn: str
    term: str
    year: int
    meeting_date: str
    days: str
    start_time: str
    end_time: str
    building: str
    room: str

    model_config = ConfigDict(from_attributes=True)
