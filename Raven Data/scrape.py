#start chrome like this from BASH: "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
#then navigate to carleton centra login, select term go to search, then start script
from selenium import webdriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.common.by import By  # Import this
import time
from bs4 import BeautifulSoup
import re
import requests
import api_client

# Connect to the existing Chrome session
chrome_options = webdriver.ChromeOptions()
chrome_options.add_experimental_option("debuggerAddress", "127.0.0.1:9222")
driver = webdriver.Chrome(options=chrome_options)

# First gather each course code on the site
subjects = driver.find_element(By.ID, 'subj_id')

#give soup the raw innerHTML
soup = BeautifulSoup(subjects.get_attribute("innerHTML"), 'html.parser')

# Find the select element with id "subj_id"
select_elem = soup.find('select', {'id': 'subj_id'})

# Extract subject codes from option values
subjects = []
for option in soup.find_all('option'):
    value = option.get('value')
    if(value):
        #if not empty
        subjects.append(option.get('value'))

#parse each subject page then add to file
count = 0
wait = WebDriverWait(driver, 10)
courses = []
for subject in subjects:
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'input[type="submit"][value="Search"][title="Search for courses based on my criteria"]')))
    submitButton = driver.find_element(By.CSS_SELECTOR, 'input[type="submit"][value="Search"][title="Search for courses based on my criteria"]')
    driver.execute_script(f"document.getElementById('subj_id').value = '{subject}';")
    submitButton.click()

    # Wait for the page to load
    try:
        # Try to parse the table of classes.
        #time.sleep(3)
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "div[width='1205'] > table[width='1200'] > tbody")))
        dataTable = driver.find_element(By.CSS_SELECTOR, "div[width='1205'] > table[width='1200'] > tbody")
        html_content = dataTable.get_attribute('innerHTML')
    except TimeoutException:
        html_content = ''
    except NoSuchElementException:
        html_content = ''
        
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'input[type="submit"][value="Return to Search"][title="Click to go back to the Search Criteria page"]')))
    returnButton = driver.find_element(By.CSS_SELECTOR, 'input[type="submit"][value="Return to Search"][title="Click to go back to the Search Criteria page"]')
    returnButton.click()

    #parsing the content
    soup = BeautifulSoup(html_content, 'html.parser')
    trs = soup.find_all('tr')

    row = 0 #row number
    course = {}
    numOfClasses = 0
    while row < len(trs):
        
        tds = trs[row].find_all('td') #get all the columns

        #if there is only 1 column, it is the indicator of the last row of the current course
        if len(tds) <= 1:
            #print("added:", course)v
            numOfClasses += 1
            courses.append(course)
            course = {}
        #if more than 2 columns, it's the first row
        elif len(tds) > 2:
            course["registration_status"] = tds[1].get_text(strip=True)
            course["crn"] = tds[2].find('a').get_text(strip=True)
            course["course_code"] = tds[3].find('a').get_text(strip=True)
            course["section"] = tds[4].get_text(strip=True)
            course["course_name"] = tds[5].find('a').get_text(strip=True)
            course["credits"] = float(tds[6].get_text(strip=True))
            course["type"] = tds[7].get_text(strip=True)
            course["instructor"] = tds[11].get_text(strip=True)
            #print("got:", course["course_code"], course["section"], "'s general info")
        elif 'Meeting Date:' in tds[1].text:
            meeting_infos = {}

            text_content = tds[1].text; #second column
            # Extract Meeting Date
            meeting_infos["meeting_date"] = text_content.split("Meeting Date:")[1].split("Days:")[0].strip()
            # Extract Days
            meeting_infos["days"] = text_content.split("Days:")[1].split("Time:")[0].strip()
            # Extract Time
            meeting_infos["time"] = text_content.split("Time:")[1].split("Building:")[0].strip()
            # Extract Building
            meeting_infos["building"] = text_content.split("Building:")[1].split("Room:")[0].strip()
            # Extract Room
            meeting_infos["room"] = text_content.split("Room:")[1].strip()

            course["meeting_infos"] = meeting_infos
            #print("got:", course["course_code"], course["section"], "'s meeting info")

        elif 'Also Register in:' in tds[1].text:
            td = tds[1]
            anchor = td.find('a', string='Also Register in:')
            if anchor:
                # Extract text after 'Also Register in:'
                register_info = td.text.split('Also Register in:')[1].strip()

                # Parse the string to create separate entries
                parts = register_info.split(' ')
                course_code = ' '.join(parts[0:2])
                sections = parts[2:]

                # Reassemble into the desired format
                course["also_register_in"] = ','.join([f"{course_code} {section}" for section in sections if section != 'or'])
                #print("got:", course["course_code"], course["section"], "'s child info")
        elif 'Section Information:' in tds[1].text:
            #dont do anything here, maybe in the future
            pass
        else:
            print("Cannot Classify Row")
        row += 1
    print("----------------------")
    print(subject, "has", numOfClasses, "classes")


#courses have been scraped, hit the api, to add/update them
# Initialize counters for tracking updates and additions
successful_updates = 0
successful_additions = 0
failed_operations = 0

expected_keys = ['registration_status', 'crn', 'course_code', 'section', 'course_name', 'credits', 'type', 'instructor', 'also_register_in']
for course in courses:
    print(f"Creating course: '{course['course_name']}")
    # Fill in some missing keys
    for key in expected_keys:
        if key not in course:
            course[key] = ''
    try:
        response = api_client.check_course_exists_by_crn(course["crn"])
        if response["exists"]:
            # Course exists, update it
            api_client.update_course_by_crn(course["crn"], course)
            successful_updates += 1  # Increment successful updates counter
        else:
            # Course does not exist, add it
            api_client.add_course(course)
            successful_additions += 1  # Increment successful additions counter
    except Exception as e:
        # Handle exceptions (if any)
        print(f"An error occurred while processing course with CRN {course['crn']}: {e}")
        failed_operations += 1  # Increment failed operations counter

# Print out the results
print(f"Successfully updated {successful_updates} courses.")
print(f"Successfully added {successful_additions} new courses.")
if failed_operations > 0:
    print(f"{failed_operations} operations failed.")
print("Done")
# You can continue with the script or end it
# driver.quit()  # If you want to close the browser