FROM selenium/standalone-chrome:latest

USER root 

# Install Python3 and pip
RUN apt-get update && apt-get install -y python3 python3-pip

# Install required Python packages
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy scraper code
COPY . /app
WORKDIR /app

# Entry point
CMD ["python3", "scrape.py"]
