"""WSGI entry point: `application` (gunicorn app:application, or Passenger via passenger_wsgi.py)."""
from mooban import config, create_app

application = create_app()

if __name__ == '__main__':
    application.run(host='0.0.0.0', port=config.PORT, threaded=True)
