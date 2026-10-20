// Pure helpers. No DOM access, importable in Node.

export function codePointLength(s) {
  return [...String(s).trim()].length;
}

/** Accessible name of an image: its alt, or a fallback naming the author. */
export function imageLabel(image, authorHandle) {
  return image.alt || `รูปจาก @${authorHandle ?? image.author?.handle ?? ''}`;
}

export function timeAgo(iso, { long = false, now = Date.now() } = {}) {
  const sec = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (sec < 60) return 'เมื่อครู่';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} นาที${long ? ' ที่แล้ว' : ''}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม.${long ? ' ที่แล้ว' : ''}`;
  if (hr < 48) return 'เมื่อวาน';
  return `${Math.floor(hr / 24)} วัน${long ? ' ที่แล้ว' : ''}`;
}

export function joinedLabel(iso) {
  const parts = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { month: 'short', year: 'numeric' })
    .formatToParts(new Date(iso));
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  return `เข้าหมู่บ้านเมื่อ ${month} ${year}`.replace(/\s+/g, ' ').trim();
}

export function avatarColor(handle) {
  let sum = 0;
  for (const ch of String(handle)) sum += ch.codePointAt(0);
  return sum % 4;
}

export function firstGrapheme(s) {
  s = String(s);
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const it = new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(s)[Symbol.iterator]().next();
    return it.done ? '' : it.value.segment;
  }
  return [...s][0] ?? '';
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const n = a.length;
  if (!n) return NaN;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

export function percentile(xs, p) {
  const a = [...xs].sort((x, y) => x - y);
  const n = a.length;
  if (!n) return NaN;
  const i = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return a[i];
}
