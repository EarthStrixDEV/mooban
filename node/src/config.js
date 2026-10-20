import path from 'node:path';
import { fileURLToPath } from 'node:url';

// node/.env is optional; real environment variables take precedence over it.
const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
try {
  process.loadEnvFile(envFile);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

function str(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (fallback === undefined) throw new Error(`Missing config key: ${key}`);
    return fallback;
  }
  return v;
}

function int(key, fallback) {
  const n = Number(str(key, String(fallback)));
  if (!Number.isInteger(n)) throw new Error(`Config key ${key} must be an integer`);
  return n;
}

export const config = Object.freeze({
  DB_HOST: str('DB_HOST'),
  DB_PORT: int('DB_PORT', 3306),
  DB_NAME: str('DB_NAME'),
  DB_USER: str('DB_USER'),
  DB_PASS: str('DB_PASS', ''),
  APP_STACK: str('APP_STACK'),
  TEST_TOKEN: str('TEST_TOKEN', ''),
  PUBLIC_DIR: path.resolve(str('PUBLIC_DIR')),
  MEDIA_DIR: path.resolve(str('MEDIA_DIR')),
  CACHE_DIR: path.resolve(str('CACHE_DIR')),
  PORT: int('PORT', 8083),
  TRUST_PROXY: str('TRUST_PROXY', '0') === '1',
  MAX_UPLOAD_BYTES: int('MAX_UPLOAD_BYTES', 10485760),
  MAX_PIXELS: int('MAX_PIXELS', 24000000),
  SSE_POLL_MS: int('SSE_POLL_MS', 1000),
  SSE_MAX_SECONDS: int('SSE_MAX_SECONDS', 60),
  MAX_STREAMS_PER_IP: int('MAX_STREAMS_PER_IP', 10),
});
