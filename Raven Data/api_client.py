import requests
import json

BASE_URL = "https://raven-planner-c88a939d35b6.herokuapp.com/api"

def add_course(course_data):
    url = f"{BASE_URL}/course"
    response = requests.post(url, json=course_data)
    return response.json()

def get_courses():
    url = f"{BASE_URL}/courses"
    response = requests.get(url)
    return response.json()

def search_course(query):
    url = f"{BASE_URL}/course/search"
    params = {'query': query}
    response = requests.get(url, params=params)
    return response.json()

def check_course_exists_by_crn(crn):
    url = f"{BASE_URL}/course/exists/{crn}"
    response = requests.get(url)
    return response.json()

def update_course_by_id(id, updated_data):
    url = f"{BASE_URL}/course/{id}"
    response = requests.put(url, json=updated_data)
    return response.json()

def update_course_by_crn(crn, updated_data):
    url = f"{BASE_URL}/course/crn/{crn}"
    response = requests.put(url, json=updated_data)
    return response.json()

def delete_course_by_id(id):
    url = f"{BASE_URL}/course/{id}"
    response = requests.delete(url)
    return response.json()

def delete_course_by_crn(crn):
    url = f"{BASE_URL}/course/crn/{crn}"
    response = requests.delete(url)
    return response.json()