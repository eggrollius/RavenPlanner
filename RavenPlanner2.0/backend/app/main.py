from fastapi import FastAPI
import subprocess

from app.models import course

from app.db.session import engine

from app.routers.course import router as course_router


app = FastAPI()

@app.on_event("startup")
def run_migrations():
    try:
        subprocess.run(["alembic", "upgrade", "head"], check=True)
    except subprocess.CalledProcessError as e:
        print(f"Alembic migration failed: {e}")

# Database setup
course.Base.metadata.create_all(bind=engine)

app.include_router(course_router)
