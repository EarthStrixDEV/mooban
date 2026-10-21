"""JSON encoding and the response shapes shared by the routes."""
import json
from datetime import datetime

from . import media

_LS = ' '
_PS = ' '


def encode(value):
    """JSON text like PHP's JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES (U+2028/2029 stay escaped)."""
    text = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    return text.replace(_LS, '\\u2028').replace(_PS, '\\u2029')


def iso(value):
    """MySQL DATETIME (datetime or 'YYYY-MM-DD HH:MM:SS', stored UTC) -> 'YYYY-MM-DDTHH:MM:SSZ'."""
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%dT%H:%M:%SZ')
    s = str(value)
    return f'{s[0:10]}T{s[11:19]}Z'


def user(row):
    return {
        'id': int(row['id']),
        'handle': str(row['handle']),
        'display_name': str(row['display_name']),
        'created_at': iso(row['created_at']),
    }


def post_image(row):
    """Image as embedded in a post: {id, thumb_url, display_url, width, height, alt}."""
    key = str(row['media_key'])
    fmt = str(row['format'])
    return {
        'id': int(row['id']),
        'thumb_url': media.url(key, fmt, 'thumb'),
        'display_url': media.url(key, fmt, 'display'),
        'width': int(row['width']),
        'height': int(row['height']),
        'alt': None if row['alt'] is None else str(row['alt']),
    }


def image(row, with_author=True):
    """Image object for /api/images; row = images columns + handle, display_name."""
    out = post_image(row)
    out['format'] = str(row['format'])
    out['bytes_thumb'] = int(row['bytes_thumb'])
    out['bytes_display'] = int(row['bytes_display'])
    out['created_at'] = iso(row['created_at'])
    if with_author:
        out['author'] = {'handle': str(row['handle']), 'display_name': str(row['display_name'])}
    return out


def post(row):
    """Post from the SELECT in routes/posts.py."""
    img = None
    if row['img_id'] is not None:
        img = post_image({
            'id': row['img_id'],
            'media_key': row['img_key'],
            'format': row['img_format'],
            'width': row['img_width'],
            'height': row['img_height'],
            'alt': row['img_alt'],
        })
    return {
        'id': int(row['id']),
        'body': str(row['body']),
        'author': {'handle': str(row['handle']), 'display_name': str(row['display_name'])},
        'image': img,
        'like_count': int(row['like_count']),
        'comment_count': int(row['comment_count']),
        'liked_by_me': row['liked'] is not None,
        'created_at': iso(row['created_at']),
        'updated_at': iso(row['updated_at']),
    }


def post_for_event(p):
    """Post as carried inside SSE events: no per-viewer liked_by_me."""
    out = dict(p)
    out.pop('liked_by_me', None)
    return out
