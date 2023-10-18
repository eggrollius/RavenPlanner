from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
import os

db = SQLAlchemy()
migrate = Migrate()

def create_app():
    app = Flask(__name__)

    # Configure database url
    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL') or'sqlite:///site.db'
    
    db.init_app(app)
    migrate.init_app(app, db)

    from .models import Course, MeetingInfo

    @app.route("/")
    def index():
        return "Hello, World!"

    return app
