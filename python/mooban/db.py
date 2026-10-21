"""PyMySQL: one connection per request (flask.g), explicit transactions via tx()."""
from contextlib import contextmanager

import pymysql
import pymysql.cursors
from flask import g

from . import config


def connect():
    """A new standalone connection (UTC, utf8mb4, autocommit). The caller closes it; used by SSE
    streams, which outlive the request context."""
    return pymysql.connect(
        host=config.DB_HOST,
        port=config.DB_PORT,
        user=config.DB_USER,
        password=config.DB_PASS,
        database=config.DB_NAME,
        charset='utf8mb4',
        init_command="SET time_zone='+00:00'",
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )


def conn():
    """The request's connection (opened on first use, UTC, utf8mb4, autocommit outside tx())."""
    c = g.get('mb_conn')
    if c is None:
        c = connect()
        g.mb_conn = c
    return c


def close(_exc=None):
    """teardown_appcontext hook."""
    c = g.pop('mb_conn', None)
    if c is not None:
        try:
            c.close()
        except pymysql.err.Error:
            pass


def all_rows(sql, args=()):
    with conn().cursor() as cur:
        cur.execute(sql, args)
        return list(cur.fetchall())


def one(sql, args=()):
    with conn().cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchone()


def run(sql, args=()):
    """Execute a write; returns (affected rows, last insert id)."""
    with conn().cursor() as cur:
        affected = cur.execute(sql, args)
        return affected, cur.lastrowid


@contextmanager
def tx():
    """One transaction on the request connection. An exception rolls back.

    If an event with id % 100 == 0 was emitted inside, old events are purged after COMMIT.
    """
    c = conn()
    g.mb_cleanup = False
    c.begin()
    try:
        yield c
        c.commit()
    except BaseException:
        try:
            c.rollback()
        except pymysql.err.Error:
            c.close()
        raise
    if g.pop('mb_cleanup', False):
        try:
            run('DELETE FROM events WHERE created_at < NOW(3) - INTERVAL 1 HOUR')
        except pymysql.err.Error as e:
            print('mooban: event cleanup failed:', type(e).__name__, flush=True)
