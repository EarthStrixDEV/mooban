"""Event log writes."""
from flask import g

from . import db
from .json_out import encode


def emit(event_type, data):
    """INSERT an event on the open transaction. Call it as the LAST statement before COMMIT.

    Every 100th event id marks the request so db.tx() purges old events after the commit.
    """
    _, event_id = db.run('INSERT INTO events (type, payload) VALUES (%s, %s)', (event_type, encode(data)))
    if event_id % 100 == 0:
        g.mb_cleanup = True
    return event_id
