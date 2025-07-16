from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import subprocess

from app.models import course

from app.db.session import engine

from app.routers.course import router as course_router
from app.routers.schedule import router as schedule_router

app = FastAPI()

origins = [
    "http://localhost:5173",      # Vite dev server
    "http://127.0.0.1:5173",      # Vite dev server (127.0.0.
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def run_migrations():
    try:
        subprocess.run(["alembic", "upgrade", "head"], check=True)
    except subprocess.CalledProcessError as e:
        print(f"Alembic migration failed: {e}")

# Database setup
course.Base.metadata.create_all(bind=engine)

app.include_router(course_router)
app.include_router(schedule_router)

print("RavenPlanner2.0 backend is running...")