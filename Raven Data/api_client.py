import requests
import json

BASE_URL = "https://www.ravenplanner.ca/api"

def add_course(course_data):
    url = f"{BASE_URL}/course"
    print(f"Request URL: {url}")
    print(f"Request Data: {course_data}")
    
    response = requests.post(url, json=course_data)
    print(f"Response Status Code: {response.status_code}")
    print(f"Response Content: {response.text}")
    
    # Check if the response is successful (status code 2xx)
    response.raise_for_status()
    
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
    print(f"Requesting URL: {url}")  # Log the URL being requested
    response = requests.get(url)
    print(f"Response Status Code: {response.status_code}")  # Log the status code
    try:
        response_json = response.json()
    except ValueError as e:
        print(f"Error parsing JSON: {e}")
        response_json = {}
    print(f"Response JSON: {response_json}")  # Log the response JSON
    return response_json

def update_course_by_id(id, updated_data):
    url = f"{BASE_URL}/course/{id}"
    response = requests.put(url, json=updated_data)
    return response.json()

def update_course_by_crn(crn, updated_data):
    url = f"{BASE_URL}/course/crn/{crn}"
    print(f"Requesting URL: {url}")  # Log the URL being requested
    print(f"Payload: {updated_data}")  # Log the payload being sent
    response = requests.put(url, json=updated_data)
    print(f"Response Status Code: {response.status_code}")  # Log the status code
    try:
        response_json = response.json()
    except ValueError as e:
        print(f"Error parsing JSON: {e}")
        response_json = {}
    print(f"Response JSON: {response_json}")  # Log the response JSON
    return response_json

def delete_course_by_id(id):
    url = f"{BASE_URL}/course/{id}"
    response = requests.delete(url)
    return response.json()

def delete_course_by_crn(crn):
    url = f"{BASE_URL}/course/crn/{crn}"
    response = requests.delete(url)
    return response.json()