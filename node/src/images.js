import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { HttpError } from './http.js';
import * as media from './media.js';

// Upload pipeline (Spec section 6): sniff -> header pixel check -> decode -> EXIF orient (JPEG only)
// -> display (<=1080 long side) -> thumb (<=320 wide, from the display image) -> write via
// .tmp-<key>/ then rename. Every client-side rejection is an HttpError.

export const DISPLAY_MAX = 1080;
export const THUMB_WIDTH = 320;

sharp.cache(false); // do not keep decoded buffers around between uploads

let forceJpeg = false;

/** Test hook (mirrors PHP Images::$forceJpeg): behave as if the encoder had no WebP support. */
export function setForceJpeg(on) {
  forceJpeg = Boolean(on);
}

export function webpAvailable() {
  return !forceJpeg && sharp.format.webp.output.buffer === true;
}

/** 'jpeg' | 'png' | 'webp' from the first bytes, or null. Never trusts name or Content-Type. */
export function detect(head) {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

const invalid = () => new HttpError(422, 'image_invalid');
const tooMany = () => new HttpError(422, 'image_too_many_pixels');

/**
 * Process the uploaded file at tmpPath. `size` is its byte length.
 * @returns {Promise<{width:number,height:number,format:string,bytes_display:number,bytes_thumb:number,media_key:string}>}
 */
export async function processUpload(tmpPath, size) {
  if (size > config.MAX_UPLOAD_BYTES) throw new HttpError(413, 'payload_too_large');
  const buf = await fs.readFile(tmpPath);
  const type = detect(buf);
  if (type === null) throw new HttpError(415, 'unsupported_media_type');

  // Header only: refuse decompression bombs before any pixel is decoded.
  let meta;
  try {
    meta = await sharp(buf, { failOn: 'none' }).metadata();
  } catch {
    throw invalid();
  }
  if (!['jpeg', 'png', 'webp'].includes(meta.format) || !(meta.width >= 1) || !(meta.height >= 1)) {
    throw invalid();
  }
  if (meta.width * meta.height > config.MAX_PIXELS) throw tooMany();

  const webp = webpAvailable();
  let displayBuf;
  let thumbBuf;
  let info;
  try {
    let pipe = sharp(buf, { limitInputPixels: config.MAX_PIXELS });
    if (type === 'jpeg') pipe = pipe.rotate(); // R11: EXIF orientation only for JPEG sources
    pipe = pipe.resize({ width: DISPLAY_MAX, height: DISPLAY_MAX, fit: 'inside', withoutEnlargement: true });
    if (webp) pipe = pipe.webp({ quality: 80 });
    else pipe = pipe.flatten({ background: '#ffffff' }).jpeg({ quality: 82 });
    ({ data: displayBuf, info } = await pipe.toBuffer({ resolveWithObject: true }));

    // R10: the thumb is resized from the display image, width min(320, display width).
    let thumb = sharp(displayBuf, { limitInputPixels: config.MAX_PIXELS })
      .resize({ width: Math.min(THUMB_WIDTH, info.width) });
    thumb = webp ? thumb.webp({ quality: 75 }) : thumb.jpeg({ quality: 78 });
    thumbBuf = await thumb.toBuffer();
  } catch (e) {
    if (/pixel limit/i.test(String(e?.message))) throw tooMany();
    throw invalid();
  }

  const key = await store(displayBuf, thumbBuf, webp ? 'webp' : 'jpg');
  return {
    width: info.width,
    height: info.height,
    format: webp ? 'webp' : 'jpeg',
    bytes_display: displayBuf.length,
    bytes_thumb: thumbBuf.length,
    media_key: key,
  };
}

/**
 * Write both files into MEDIA_DIR/.tmp-<key>/ then rename to MEDIA_DIR/<key>/ so a reader
 * (or a crash) sees both files or neither. Removes the staging dir on any failure.
 */
export async function store(displayBytes, thumbBytes, ext) {
  const root = config.MEDIA_DIR;
  await fs.mkdir(root, { recursive: true, mode: 0o755 });

  let key = null;
  let tmp = '';
  for (let i = 0; i < 5 && key === null; i++) {
    const candidate = randomBytes(8).toString('hex');
    tmp = path.join(root, `.tmp-${candidate}`);
    const taken = await fs.stat(path.join(root, candidate)).then(() => true, () => false);
    if (taken) continue;
    try {
      await fs.mkdir(tmp, { mode: 0o755 }); // not recursive: fails when the staging dir exists
      key = candidate;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  if (key === null) throw new Error('cannot allocate media key');

  try {
    await fs.chmod(tmp, 0o755); // mkdir mode is masked by umask
    for (const [name, bytes] of [['display', displayBytes], ['thumb', thumbBytes]]) {
      const file = path.join(tmp, `${name}.${ext}`);
      await fs.writeFile(file, bytes, { mode: 0o644 });
      await fs.chmod(file, 0o644);
    }
    await fs.rename(tmp, path.join(root, key));
  } catch (e) {
    await media.removeTmpDir(key);
    throw e;
  }
  return key;
}
