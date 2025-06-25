from app.models import Course, Meeting
from app.schemas.course import CourseCreate

from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import case, or_, desc
from sqlalchemy.exc import SQLAlchemyError

def create_or_update_course(db: Session, course_data: CourseCreate):
    # Exclude nested 'meetings' list from the upsert operation
    course_data_dict = course_data.dict(exclude={"meetings"})

    query = (
        insert(Course)
        .values(**course_data_dict)
        .on_conflict_do_update(
            index_elements=['crn', 'term', 'year'],
            set_=course_data_dict
        )
    )

    try:
        db.execute(query)

        # Remove old meetings associated with this course (if any)
        db.query(Meeting).filter_by(
            crn=course_data.crn,
            term=course_data.term,
            year=course_data.year
        ).delete()

        # Add the new meetings
        for meeting_data in course_data.meetings:
            meeting = Meeting(
                crn=course_data.crn,
                term=course_data.term,
                year=course_data.year,
                **meeting_data.dict()
            )
            db.add(meeting)

        db.commit()

    except SQLAlchemyError as e:
        db.rollback()
        raise e

def search_courses_by_query(db: Session, q: str, page: int, size: int):
    offset = (page - 1) * size

    relevance = case(
        (Course.course_code.ilike(f"{q}%"), 2),
        (Course.course_name.ilike(f"{q}%"), 1),
        else_=0
    )

    results = (
        db.query(Course)
        .filter(
            or_(
                Course.course_code.ilike(f"{q}%"),
                Course.course_name.ilike(f"{q}%")
            )
        )
        .order_by(desc(relevance))
        .offset(offset)
        .limit(size)
        .all()
    )

    return results