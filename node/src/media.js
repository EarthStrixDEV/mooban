import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const KEY_RE = /^[0-9a-f]{16}$/;

/** Public URL of one rendition: /media/<key>/<display|thumb>.<webp|jpg>. */
export function url(key, format, kind) {
  return `/media/${key}/${kind}.${format === 'webp' ? 'webp' : 'jpg'}`;
}

async function rm(dir) {
  let st;
  try {
    st = await fs.lstat(dir);
  } catch {
    return;
  }
  if (!st.isDirectory()) return; // lstat: a symlink is not a directory, so it is skipped
  await fs.rm(dir, { recursive: true, force: true });
}

/** Recursively delete MEDIA_DIR/<key>. Ignored when absent; keys must be 16 hex chars. */
export async function removeDir(key) {
  if (!KEY_RE.test(key)) return;
  await rm(path.join(config.MEDIA_DIR, key));
}

/** Delete the half-written MEDIA_DIR/.tmp-<key> staging directory. */
export async function removeTmpDir(key) {
  if (!KEY_RE.test(key)) return;
  await rm(path.join(config.MEDIA_DIR, `.tmp-${key}`));
}

/** Static handler for /media: immutable, nosniff, ETag/Last-Modified, no listing, no dotfiles (.tmp-* staging dirs). */
export function handler() {
  const files = express.static(config.MEDIA_DIR, {
    index: false,
    redirect: false,
    dotfiles: 'deny',
    maxAge: '365d',
    immutable: true,
    etag: true,
    lastModified: true,
    setHeaders(res) {
      res.set('X-Content-Type-Options', 'nosniff');
    },
  });
  return (req, res, next) => {
    // fetch() adds "Cache-Control: no-cache" to conditional requests, and `fresh` then never answers 304.
    // Revalidating is exactly what a conditional request does (and the files are immutable), so ignore it.
    delete req.headers['cache-control'];
    files(req, res, next);
  };
}
