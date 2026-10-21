"""X-Test-Token gate for the test tools (mirrors php/src/TestGuard.php)."""
import hmac

from flask import request

from . import config
from .http import HttpError


def require():
    """403 {"error":"forbidden"} unless X-Test-Token matches TEST_TOKEN (constant-time compare)."""
    expected = config.TEST_TOKEN.encode('utf-8')
    given = request.headers.get('X-Test-Token', '').encode('utf-8')
    if not expected or not hmac.compare_digest(expected, given):
        raise HttpError(403, 'forbidden')
