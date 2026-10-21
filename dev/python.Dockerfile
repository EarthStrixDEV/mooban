# Dev image for the Python stack. Dependencies are installed into the image (never a host venv);
# the sources are bind-mounted at /app/python and run with gunicorn (flask-sock needs threaded workers).
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
WORKDIR /app/python
