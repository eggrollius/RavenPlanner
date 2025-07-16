from app.schemas.schedule import ScheduleSchema

class Schedule:
    def __init__(self, year: int, term: str):
        self.courses = {}
        self.year = year
        self.term = term

    def add_course(self, crn: int, meetings: list):
        self.courses[crn] = meetings

    def to_schema(self) -> "ScheduleSchema":
        return ScheduleSchema(crns=self.crns, times=self.times)
