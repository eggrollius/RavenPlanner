from locust import HttpUser, task, between

class CourseSearchUser(HttpUser):
    wait_time = between(0.1, 0.5) 

    @task
    def search_courses(self):
        query = "COMP"
        page = 1
        size = 10
        self.client.get(f"/courses/search?q={query}&page={page}&size={size}")
