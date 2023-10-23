import os
from app import create_app #defined in __init.py__
from app.api import api  

from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy

app = create_app()
app.debug = True

if __name__ == '__main__':
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', 5000))
    app.run(host=host, port=port)

