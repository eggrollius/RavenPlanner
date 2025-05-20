from selenium import webdriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support.ui import Select
from selenium.webdriver.common.by import By
from bs4 import BeautifulSoup
import api_client
import json
import time
import os

username = os.environ.get('CARLETON_CENTRAL_USERNAME')
password = os.environ.get('CARLETON_CENTRAL_PASSWORD')
if not username or not password:
    print("Error: Environment variables CARLETON_CENTRAL_USERNAME and CARLETON_CENTRAL_PASSWORD must be set.")
    sys.exit(1) 

chrome_options = webdriver.ChromeOptions()
chrome_options.add_argument("--headless")
chrome_options.add_argument("--no-sandbox")
chrome_options.add_argument("--disable-dev-shm-usage")
chrome_options.add_argument("--disable-gpu")
chrome_options.add_argument("--window-size=1920,1080")

# Start Chrome
driver = webdriver.Chrome(options=chrome_options)

# Goto the login page
driver.get('https://central.carleton.ca/')

wait = WebDriverWait(driver, 10)

# Login
wait.until(EC.presence_of_element_located((By.XPATH, '//*[@id="userNameInput"]')))
usernameInput = driver.find_element(By.XPATH, '//*[@id="userNameInput"]')
usernameInput.send_keys(username)

wait.until(EC.presence_of_element_located((By.XPATH, '//*[@id="passwordInput"]')))
passwordInput = driver.find_element(By.XPATH, '//*[@id="passwordInput"]')
passwordInput.send_keys(password)

wait.until(EC.element_to_be_clickable((By.XPATH, '//*[@id="submitButton"]')))
loginButton = driver.find_element(By.XPATH, '//*[@id="submitButton"]')
loginButton.click()

# Navigate to Time Table
wait.until(EC.element_to_be_clickable((By.XPATH, '/html/body/div[3]/table[1]/tbody/tr[3]/td[2]/span/ul/li[1]/a[3]')))
buildTimeTable = driver.find_element(By.XPATH, '/html/body/div[3]/table[1]/tbody/tr[3]/td[2]/span/ul/li[1]/a[3]')
buildTimeTable.click()

# Select Term
dropdown_element = wait.until(EC.presence_of_element_located((By.ID, 'term_code')))
dropdown = Select(dropdown_element)
dropdown.select_by_visible_text('Summer 2025 (May-August)')

# Proceed to Search
time.sleep(3)
wait.until(EC.element_to_be_clickable((By.XPATH, '//*[@id="ws_div"]/input[1]')))
proceedToSearch = driver.find_element(By.XPATH, '//*[@id="ws_div"]/input[1]')
proceedToSearch.click()

time.sleep(3)

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
courses = []
for subject in subjects:
    wait.until(EC.presence_of_element_located((By.XPATH, '/html/body/div[3]/form/table[2]/tbody/tr[5]/td/input[1]')))
    submitButton = driver.find_element(By.XPATH, '/html/body/div[3]/form/table[2]/tbody/tr[5]/td/input[1]')
    driver.execute_script(f"document.getElementById('subj_id').value = '{subject}';")
    submitButton.click()

    # Wait for the page to load
    try:
        # Try to parse the table of classes.
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "div[width='1205'] > table[width='1200'] > tbody")))
        dataTable = driver.find_element(By.CSS_SELECTOR, "div[width='1205'] > table[width='1200'] > tbody")
        html_content = dataTable.get_attribute('innerHTML')
    except TimeoutException:
        html_content = ''
    except NoSuchElementException:
        html_content = ''
        
    wait.until(EC.presence_of_element_located((By.XPATH, '//input[@type="submit" and @value="Return to Search" and @title="Click to go back to the Search Criteria page"]')))
    returnButton = driver.find_element(By.XPATH, '//input[@type="submit" and @value="Return to Search" and @title="Click to go back to the Search Criteria page"]')
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

expected_keys = ['registration_status', 'crn', 'course_code', 'section', 'course_name', 'credits', 'type', 'instructor', 'also_register_in', 'term', 'year']
for course in courses:
    print(f"Creating course: '{course['course_name']}")
    # Fill in some missing keys
    for key in expected_keys:
        if key not in course:
            if key == 'term':
                course[key] = 'SUMMER'
            elif key == 'year':
                course[key] = 2025      
            else:
                course[key] = ''
    try:
        response = api_client.check_course_exists_by_crn(course["crn"])
        if response["exists"]:
            # Course exists, update it
            api_client.update_course_by_crn(course["crn"], course)
            successful_updates += 1  
        else:
            # Course does not exist, add it
            api_client.add_course(course)
            successful_additions += 1 
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