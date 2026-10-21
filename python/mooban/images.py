"""Upload pipeline (Spec section 6): sniff -> header pixel check -> decode -> EXIF orient (JPEG only)
-> display (<=1080 long side) -> thumb (<=320 wide, from the display image) -> write via
.tmp-<key>/ then rename. Every client-side rejection is an HttpError."""
import io
import os
import secrets
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError, features

from . import config, media
from .http import HttpError

DISPLAY_MAX = 1080
THUMB_WIDTH = 320

# Backstop behind the explicit header check: Pillow itself refuses images beyond 2 * MAX_PIXELS
# (DecompressionBombError) and warns beyond MAX_PIXELS; the warning is turned into an error.
Image.MAX_IMAGE_PIXELS = config.MAX_PIXELS
warnings.simplefilter('error', Image.DecompressionBombWarning)

_force_jpeg = False
_PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
_BOMBS = (Image.DecompressionBombError, Image.DecompressionBombWarning)


def set_force_jpeg(on):
    """Test hook (mirrors Node setForceJpeg): behave as if the encoder had no WebP support."""
    global _force_jpeg
    _force_jpeg = bool(on)


def webp_available():
    return not _force_jpeg and bool(features.check('webp'))


def detect(head):
    """'jpeg' | 'png' | 'webp' from the first bytes, or None. Never trusts name or Content-Type."""
    if head[:3] == b'\xff\xd8\xff':
        return 'jpeg'
    if head[:8] == _PNG_SIGNATURE:
        return 'png'
    if len(head) >= 12 and head[:4] == b'RIFF' and head[8:12] == b'WEBP':
        return 'webp'
    return None


def _invalid():
    return HttpError(422, 'image_invalid')


def _too_many():
    return HttpError(422, 'image_too_many_pixels')


def _normalize(im):
    """RGB or RGBA (alpha kept), whatever the source mode (P, L, LA, CMYK, 16-bit ...)."""
    if im.mode in ('RGB', 'RGBA'):
        return im
    has_alpha = im.mode in ('LA', 'PA', 'La', 'RGBa') or 'transparency' in im.info
    return im.convert('RGBA' if has_alpha else 'RGB')


def _flatten(im):
    """RGBA -> RGB on a white background (JPEG has no alpha)."""
    if im.mode != 'RGBA':
        return im
    bg = Image.new('RGB', im.size, (255, 255, 255))
    bg.paste(im, mask=im.getchannel('A'))
    return bg


def _encode(im, webp, webp_quality, jpeg_quality):
    """Encoded bytes; never passes exif= or icc_profile= so no metadata survives."""
    buf = io.BytesIO()
    if webp:
        im.save(buf, 'WEBP', quality=webp_quality)
    else:
        _flatten(im).save(buf, 'JPEG', quality=jpeg_quality, icc_profile=None)
    return buf.getvalue()


def process(fp, size):
    """Process the fully received upload `fp` (seekable, `size` bytes).

    Returns {width, height, format, bytes_display, bytes_thumb, media_key}; files are already stored.
    """
    if size > config.MAX_UPLOAD_BYTES:
        raise HttpError(413, 'payload_too_large')
    fp.seek(0)
    kind = detect(fp.read(12))
    if kind is None:
        raise HttpError(415, 'unsupported_media_type')
    fp.seek(0)

    webp = webp_available()
    box = (DISPLAY_MAX, DISPLAY_MAX)
    try:
        # Lazy open: the header alone gives the size, so a bomb is refused before any pixel is decoded.
        src = Image.open(fp, formats=['JPEG', 'PNG', 'WEBP'])
    except _BOMBS:
        raise _too_many() from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise _invalid() from None
    # src wraps the caller's file object, so it is never close()d here (that would free the pixels).
    width, height = src.size
    if width < 1 or height < 1:
        raise _invalid()
    if width * height > config.MAX_PIXELS:
        raise _too_many()
    try:
        if kind == 'jpeg':
            # thumbnail() on the lazy JPEG decodes at a reduced DCT scale (draft) and never upscales;
            # R11: only JPEG sources are rotated by their EXIF orientation.
            src.thumbnail(box, Image.LANCZOS)
            display = _normalize(ImageOps.exif_transpose(src))
        else:
            src.load()
            display = _normalize(src)
            display.thumbnail(box, Image.LANCZOS)
        display.load()
    except _BOMBS:
        raise _too_many() from None
    except MemoryError:
        raise
    except Exception:  # decode failures surface as OSError, SyntaxError, struct.error, ...
        raise _invalid() from None

    dw, dh = display.size
    # R10: the thumb is resized from the display image, width min(320, display width), same ratio.
    tw = min(THUMB_WIDTH, dw)
    thumb = display if tw == dw else display.resize((tw, max(1, round(dh * tw / dw))), Image.LANCZOS)

    try:
        display_bytes = _encode(display, webp, 80, 82)
        thumb_bytes = _encode(thumb, webp, 75, 78)
    except MemoryError:
        raise
    except Exception:
        raise _invalid() from None

    key = store(display_bytes, thumb_bytes, 'webp' if webp else 'jpg')
    return {
        'width': dw,
        'height': dh,
        'format': 'webp' if webp else 'jpeg',
        'bytes_display': len(display_bytes),
        'bytes_thumb': len(thumb_bytes),
        'media_key': key,
    }


def store(display_bytes, thumb_bytes, ext):
    """Write both files into MEDIA_DIR/.tmp-<key>/ then rename to MEDIA_DIR/<key>/ so a reader
    (or a crash) sees both files or neither. Removes the staging dir on any failure."""
    root = config.MEDIA_DIR
    os.makedirs(root, mode=0o755, exist_ok=True)

    key = None
    tmp = ''
    for _ in range(5):
        candidate = secrets.token_hex(8)
        if os.path.lexists(os.path.join(root, candidate)):
            continue
        tmp = os.path.join(root, f'.tmp-{candidate}')
        try:
            os.mkdir(tmp, 0o755)  # not makedirs: fails when the staging dir exists
        except FileExistsError:
            continue
        key = candidate
        break
    if key is None:
        raise RuntimeError('cannot allocate media key')

    try:
        os.chmod(tmp, 0o755)  # mkdir mode is masked by umask
        for name, data in (('display', display_bytes), ('thumb', thumb_bytes)):
            path = os.path.join(tmp, f'{name}.{ext}')
            with open(path, 'wb') as fh:
                fh.write(data)
            os.chmod(path, 0o644)
        os.rename(tmp, os.path.join(root, key))
    except BaseException:
        media.remove_tmp_dir(key)
        raise
    return key
