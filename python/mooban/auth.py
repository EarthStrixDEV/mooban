"""Bearer-token authentication (tokens are stored as SHA-256 hex)."""
import hashlib

from . import db
from .http import HttpError, bearer


def optional():
    """users row {id, handle, display_name, created_at} for the Bearer token, or None."""
    token = bearer()
    if token is None:
        return None
    digest = hashlib.sha256(token.encode('utf-8')).hexdigest()
    return db.one(
        'SELECT id, handle, display_name, created_at FROM users WHERE token_hash = %s LIMIT 1',
        (digest,),
    )


def require():
    user = optional()
    if user is None:
        raise HttpError(401, 'unauthorized')
    return user
