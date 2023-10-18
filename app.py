from app import create_app #defined in __init.py__
from app.api import api  

from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy

app = create_app()

if __name__ == '__main__':
    app.run()
