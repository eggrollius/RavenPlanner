from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.schemas.course import CourseCreate, CourseRead
from app.services.course import create_or_update_course, search_courses_by_query
from typing import List
router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.put("/course")
def add_course(course_data: CourseCreate, db: Session = Depends(get_db)):
    try:
        create_or_update_course(db, course_data)

        return {"message": "New course created or updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/courses/search", response_model=List[CourseRead])
def search_courses(
    q: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    try:
        courses = search_courses_by_query(db, q, page, size)
        if not courses:
            raise HTTPException(status_code=404, detail="No matching courses found.")
        return courses
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
