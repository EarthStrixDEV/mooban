import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { HttpError } from './http.js';

// Prefixes owned by the API/media/realtime layers: never answered with index.html.
const RESERVED_RE = /^\/(api|media|ws|download|upload|cache)(\/|$)/;
const HTML_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:",
  'X-Content-Type-Options': 'nosniff',
};

/** Static files from PUBLIC_DIR, then index.html for unknown GET/HEAD paths outside the reserved prefixes. */
export function mount(app) {
  app.use((req, res, next) => {
    // A reserved prefix nothing above answered is a plain JSON 404, never HTML.
    if (RESERVED_RE.test(req.path)) next(new HttpError(404, 'not_found'));
    else next();
  });

  app.use(express.static(config.PUBLIC_DIR, {
    index: false,
    etag: true,
    setHeaders(res, file) {
      if (path.basename(file) === 'index.html') res.set(HTML_HEADERS);
    },
  }));

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next(new HttpError(404, 'not_found'));
      return;
    }
    res.sendFile('index.html', { root: config.PUBLIC_DIR, headers: HTML_HEADERS }, (err) => {
      if (err) next(err);
    });
  });
}
