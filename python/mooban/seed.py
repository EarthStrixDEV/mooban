"""Test-data tools (Spec section 8): seed, wipe and the media/DB consistency check.
Mirrors php/src/Seed.php."""
import hashlib
import json
import os
import re
import secrets
import time
from datetime import datetime, timezone

from . import config, db, images, media, stats

SPAN_SECONDS = 7 * 86400
BATCH = 500
SEED_LIKE = 'seed\\_%'  # MySQL pattern seed\_% (escaped underscore)
_SEED_HANDLE_RE = re.compile(r'seed_([0-9]+)\Z')
_KEY_RE = re.compile(r'[0-9a-f]{16}\Z')


def _fmt(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime('%Y-%m-%d %H:%M:%S')


def _texts():
    candidates = [
        os.path.join(os.path.dirname(config.PUBLIC_DIR), 'seed-texts.json'),
        os.path.join(os.path.dirname(config.BASE_DIR), 'shared', 'seed-texts.json'),
    ]
    for path in candidates:
        try:
            with open(path, encoding='utf-8') as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            continue
        if isinstance(data, list) and data:
            return [str(t) for t in data]
    raise RuntimeError('seed-texts.json missing or invalid')


def run(users, posts, image_count):
    """Insert `users` seed users, `posts` posts and `image_count` images in one transaction."""
    t0 = time.perf_counter()
    texts = _texts()

    # Continue after the highest existing seed_NNN.
    top = 0
    for row in db.all_rows('SELECT handle FROM users WHERE handle LIKE %s', (SEED_LIKE,)):
        m = _SEED_HANDLE_RE.match(str(row['handle']))
        if m:
            top = max(top, int(m.group(1)))

    start = int(time.time()) - SPAN_SECONDS
    # Post i: evenly spread over the last 7 days, oldest first (ids rise with time).
    def at(i):
        return start + (i * SPAN_SECONDS) // max(1, posts)

    keys = []
    try:
        # Process sample.jpg once; the first image keeps that dir, the others are copies.
        img = None
        if image_count > 0:
            path = os.path.join(config.PUBLIC_DIR, 'sample.jpg')
            if not os.path.isfile(path):
                raise RuntimeError('sample.jpg not found')
            with open(path, 'rb') as fh:
                img = images.process(fh, os.path.getsize(path))
            ext = 'webp' if img['format'] == 'webp' else 'jpg'
            keys.append(img['media_key'])
            folder = os.path.join(config.MEDIA_DIR, img['media_key'])
            with open(os.path.join(folder, f'display.{ext}'), 'rb') as fh:
                display = fh.read()
            with open(os.path.join(folder, f'thumb.{ext}'), 'rb') as fh:
                thumb = fh.read()
            for _ in range(1, image_count):
                keys.append(images.store(display, thumb, ext))

        with db.tx():
            handles = []
            ph = []
            args = []
            for i in range(1, users + 1):
                n = f'{top + i:03d}'
                handles.append(f'seed_{n}')
                ph.append('(%s, %s, %s, %s)')
                # Token is random and thrown away: only its hash is stored.
                args += [f'seed_{n}', f'Seed {n}', hashlib.sha256(secrets.token_hex(32).encode()).hexdigest(),
                         _fmt(start)]
            db.run(f'INSERT INTO users (handle, display_name, token_hash, created_at) VALUES {",".join(ph)}', args)
            rows = db.all_rows(f'SELECT handle, id FROM users WHERE handle IN ({",".join(["%s"] * users)})', handles)
            by_handle = {str(r['handle']): int(r['id']) for r in rows}
            user_ids = [by_handle[h] for h in handles]

            # Image i belongs to the author of post i and is attached to it below.
            image_ids = []
            for i in range(image_count):
                _, new_id = db.run(
                    'INSERT INTO images (user_id, media_key, width, height, format, bytes_display, bytes_thumb, '
                    'alt, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, %s)',
                    (user_ids[i % users], keys[i], img['width'], img['height'], img['format'],
                     img['bytes_display'], img['bytes_thumb'], _fmt(at(i))))
                image_ids.append(new_id)

            for lo in range(0, posts, BATCH):
                hi = min(posts, lo + BATCH)
                pph = []
                pargs = []
                for i in range(lo, hi):
                    ts = _fmt(at(i))
                    pph.append('(%s, %s, %s, %s, %s)')
                    pargs += [user_ids[i % users], texts[secrets.randbelow(len(texts))],
                              image_ids[i] if i < len(image_ids) else None, ts, ts]
                db.run(f'INSERT INTO posts (user_id, body, image_id, created_at, updated_at) VALUES {",".join(pph)}',
                       pargs)
    except BaseException:
        for k in keys:
            media.remove_dir(k)
        raise

    stats.invalidate()
    return {
        'users': users,
        'posts': posts,
        'images': image_count,
        'duration_ms': int(round((time.perf_counter() - t0) * 1000)),
    }


def wipe():
    users = int(db.one('SELECT COUNT(*) AS n FROM users WHERE handle LIKE %s', (SEED_LIKE,))['n'])
    posts = int(db.one('SELECT COUNT(*) AS n FROM posts p JOIN users u ON u.id = p.user_id WHERE u.handle LIKE %s',
                       (SEED_LIKE,))['n'])
    keys = [str(r['media_key']) for r in db.all_rows(
        'SELECT i.media_key FROM images i JOIN users u ON u.id = i.user_id WHERE u.handle LIKE %s', (SEED_LIKE,))]

    # FKs cascade posts, images, likes and comments; the media dirs are ours to remove.
    db.run('DELETE FROM users WHERE handle LIKE %s', (SEED_LIKE,))
    for k in keys:
        media.remove_dir(k)
    stats.invalidate()

    return {'deleted_users': users, 'deleted_posts': posts, 'deleted_images': len(keys)}


def orphans():
    root = config.MEDIA_DIR
    known = set()
    missing = 0
    for r in db.all_rows('SELECT media_key, format FROM images'):
        key = str(r['media_key'])
        known.add(key)
        ext = 'webp' if r['format'] == 'webp' else 'jpg'
        if not os.path.isfile(os.path.join(root, key, f'display.{ext}')) \
                or not os.path.isfile(os.path.join(root, key, f'thumb.{ext}')):
            missing += 1

    count = 0
    try:
        names = os.listdir(root)
    except OSError:
        names = []
    for name in names:
        if _KEY_RE.match(name) and name not in known and os.path.isdir(os.path.join(root, name)):
            count += 1
    return {'orphan_dirs': count, 'missing_files': missing}
