# app/services/schedule_service.py
from types import SimpleNamespace
from app.models.course import Course

from sqlalchemy import func, tuple_
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.schemas.course import CourseRead
from app.models.meeting import Meeting
from ortools.sat.python import cp_model

class ScheduleService:
    @staticmethod
    def _get_filtered_courses(db: Session, required_codes: list[str], avoid_sections: list[str]):
        """
        # Normalize avoid_sections: "COMP1405 B1" → ("COMP1405", "B1")
        avoid_pairs = [s.upper().split() for s in avoid_sections]  # list of [code, section]
        
        query = db.query(Course).filter(
            Course.course_code.in_([c.upper() for c in required_codes]),
            tuple_(func.upper(Course.course_code), func.upper(Course.section)).notin_(avoid_pairs)
        )
        return query.all()
        """
        mock_courses = [
            Course(
                crn="12345",
                term="Fall",
                year=2025,
                registration_status="Open",
                course_code="COMP 1405",
                section="A",
                course_name="Intro to Computer Science",
                credits=0.5,
                type="Lecture",
                instructor="Dr. Smith",
                also_register_in=None,
                meetings=[
                    Meeting(
                        crn="12345",
                        term="Fall",
                        year=2025,
                        meeting_date="Mon",
                        days="Mon Tue",
                        start_time="09:00",
                        end_time="11:00",
                        building="HP",
                        room="4155"
                    )
                ]
            ),
            Course(
                crn="13579",
                term="Fall",
                year=2025,
                registration_status="Open",
                course_code="COMP 1405",
                section="B",
                course_name="Intro to Computer Science",
                credits=0.5,
                type="Lecture",
                instructor="Dr. Wong",
                also_register_in=None,
                meetings=[
                    Meeting(
                        crn="13579",
                        term="Fall",
                        year=2025,
                        meeting_date="Wed",
                        days="Mon Fri",
                        start_time="10:00",
                        end_time="12:00",
                        building="RB",
                        room="1200"
                    )
                ]
            ),
            Course(
                crn="67890",
                term="Fall",
                year=2025,
                registration_status="Open",
                course_code="MATH 1007",
                section="A",
                course_name="Calculus I",
                credits=0.5,
                type="Lecture",
                instructor="Dr. Lee",
                also_register_in=None,
                meetings=[
                    Meeting(
                        crn="67890",
                        term="Fall",
                        year=2025,
                        meeting_date="Tue",
                        days="Tue Thu",
                        start_time="10:00",
                        end_time="12:00",
                        building="CB",
                        room="210"
                    )
                ]
            )
        ]

        # Apply manual filtering like the real method
        required_codes = [c.upper() for c in required_codes]
        avoid_set = set(s.upper() for s in avoid_sections)

        def include(course):
            key = f"{course.course_code.upper()} {course.section.upper()}"
            return course.course_code.upper() in required_codes and key not in avoid_set

        return [c for c in mock_courses if include(c)]
    @staticmethod
    def get_schedule(required_course_codes: list, number_of_courses: int, avoid_sections: list) -> dict:
        print("Getting schedule with required courses:", required_course_codes)
        db: Session = SessionLocal()
        try:
            courses = ScheduleService._get_filtered_courses(db, required_course_codes, avoid_sections)
        finally:
            db.close()
        
        model = cp_model.CpModel()
        n = len(courses)

        x = [model.NewBoolVar(f'select_{i}') for i in range(n)]
        model.Add(sum(x) == number_of_courses)

        def meetings_conflict(m1, m2):
            days1 = m1.days.upper().split()
            days2 = m2.days.upper().split()

            if not set(days1).intersection(days2):
                return False
            
            if m1.start_time <= m2.end_time and m1.start_time >= m2.start_time:
                return True
            if m2.start_time <= m1.end_time and m2.start_time >= m1.start_time:
                return True
            return False

        for i in range(n):
            for j in range(i + 1, n):
                for m1 in getattr(courses[i], 'meetings', []):
                    for m2 in getattr(courses[j], 'meetings', []):
                        if meetings_conflict(m1, m2):
                            model.Add(x[i] + x[j] <= 1)

        required_codes = set(required_course_codes)
        for code in required_codes:
            model.Add(sum(x[i] for i in range(n) if courses[i].course_code == code) == 1)

        # Collect up to 10 solutions
        class TopSchedulesCallback(cp_model.CpSolverSolutionCallback):
            def __init__(self, x_vars, courses, max_solutions=10):
                cp_model.CpSolverSolutionCallback.__init__(self)
                self.x_vars = x_vars
                self.courses = courses
                self.max_solutions = max_solutions
                self.solutions = []
            def on_solution_callback(self):
                selected = [self.courses[i] for i in range(len(self.x_vars)) if self.Value(self.x_vars[i])]
                self.solutions.append(selected)
                if len(self.solutions) >= self.max_solutions:
                    self.StopSearch()

        solver = cp_model.CpSolver()
        callback = TopSchedulesCallback(x, courses, max_solutions=10)
        status = solver.SearchForAllSolutions(model, callback)

        if callback.solutions:
            return {
                "schedules": [
                    [CourseRead.model_validate(c, from_attributes=True) for c in schedule]
                    for schedule in callback.solutions
                ]
            }
        else:
            return {"schedules": [], "error": "No feasible schedule found."}
