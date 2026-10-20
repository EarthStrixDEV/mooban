import * as media from './media.js';

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const BACKSLASH = String.fromCharCode(0x5c);

/** JSON text like PHP's JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES (U+2028/2029 stay escaped). */
export function encode(value) {
  return JSON.stringify(value).replaceAll(LS, BACKSLASH + 'u2028').replaceAll(PS, BACKSLASH + 'u2029');
}

/** MySQL 'YYYY-MM-DD HH:MM:SS' (stored UTC) -> 'YYYY-MM-DDTHH:MM:SSZ'. */
export function iso(mysqlDatetime) {
  const s = String(mysqlDatetime);
  return `${s.slice(0, 10)}T${s.slice(11, 19)}Z`;
}

export function user(row) {
  return {
    id: Number(row.id),
    handle: String(row.handle),
    display_name: String(row.display_name),
    created_at: iso(row.created_at),
  };
}

/** Image as embedded in a post: {id, thumb_url, display_url, width, height, alt}. */
export function postImage(row) {
  const key = String(row.media_key);
  const format = String(row.format);
  return {
    id: Number(row.id),
    thumb_url: media.url(key, format, 'thumb'),
    display_url: media.url(key, format, 'display'),
    width: Number(row.width),
    height: Number(row.height),
    alt: row.alt === null ? null : String(row.alt),
  };
}

/** Image object for /api/images; row = images columns + handle, display_name. */
export function image(row, withAuthor = true) {
  const out = {
    ...postImage(row),
    format: String(row.format),
    bytes_thumb: Number(row.bytes_thumb),
    bytes_display: Number(row.bytes_display),
    created_at: iso(row.created_at),
  };
  if (withAuthor) {
    out.author = { handle: String(row.handle), display_name: String(row.display_name) };
  }
  return out;
}

/** Post from the posts SELECT row (see routes/posts.js). */
export function post(row) {
  const img = row.img_id === null ? null : postImage({
    id: row.img_id,
    media_key: row.img_key,
    format: row.img_format,
    width: row.img_width,
    height: row.img_height,
    alt: row.img_alt,
  });
  return {
    id: Number(row.id),
    body: String(row.body),
    author: { handle: String(row.handle), display_name: String(row.display_name) },
    image: img,
    like_count: Number(row.like_count),
    comment_count: Number(row.comment_count),
    liked_by_me: row.liked !== null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

/** Post as carried inside SSE events: no per-viewer liked_by_me. */
export function postForEvent(p) {
  const out = { ...p };
  delete out.liked_by_me;
  return out;
}
