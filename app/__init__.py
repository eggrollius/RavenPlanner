from flask import Flask
from flask_sqlalchemy import SQLAlchemy
import os

app = Flask(__name__)

# Configure database
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL') or 'sqlite:///site.db'
db = SQLAlchemy(app)

# Import models
from models import Course, MeetingInfo

@app.route("/")
def index():
    return "Hello, World!"

if __name__ == "__main__":
    app.run()
