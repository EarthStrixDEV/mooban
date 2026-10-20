// Card 1: image upload timing (DESIGN 4.13, 6.8).
import { h } from '../dom.js';
import { api, ApiError } from '../api.js';
import { state } from '../store.js';
import { formatBytes } from '../util.js';
import { toast } from '../ui/toast.js';
import { requireUser, handleAuthError } from '../ui/signup.js';
import { reportApiError } from '../ui/errors.js';
import { card, note, tiles, tile, kv, table, button, fmt1 } from './common.js';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const THUMB_W = 320;

// In memory only: gone on refresh (DESIGN 6.8).
const history = [];
let lastUpload = null; // {id}

const isJpeg = (fmt) => /jpe?g/i.test(fmt);
const mime = (fmt) => (String(fmt).includes('/') ? fmt : `image/${fmt}`);
const kind = (type) => ({ 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' }[type] ?? 'ไฟล์');

/** Bytes of a client-side JPEG thumbnail (width min(320, natural width), quality .75), or null. */
async function jpegThumbBytes(file) {
  try {
    if (typeof createImageBitmap !== 'function') return null;
    const bmp = await createImageBitmap(file);
    const w = Math.min(THUMB_W, bmp.width);
    const hgt = Math.max(1, Math.round(bmp.height * (w / bmp.width)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff'; // JPEG has no alpha: flatten PNG/WebP transparency the same way a JPEG thumb would
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(bmp, 0, 0, w, hgt);
    bmp.close?.();
    const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', 0.75); });
    return blob && blob.size > 0 ? blob.size : null;
  } catch {
    return null;
  }
}

export function mountUploadCard() {
  const { root, body } = card('1. อัปโหลดรูป', { span: 'rows' });
  const msg = note();
  const ctrl = new AbortController();
  let last = null;

  const input = h('input', {
    type: 'file', id: 'test-file', class: 'sr-only', accept: ACCEPT, 'data-testid': 'test-upload-file',
    onchange: () => { const f = input.files?.[0]; if (f) run(f); input.value = ''; },
  });
  const pick = h('label', { class: 'btn btn--primary tbtn tpick', for: 'test-file' }, 'เลือกรูป', input);
  const fileInfo = h('p', { class: 'tcard__sub', 'data-testid': 'test-upload-name' });

  const drop = h('div', { class: 'tdrop only-wide' }, 'หรือลากรูปมาวางที่นี่');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.dataset.over = ''; });
  drop.addEventListener('dragleave', () => delete drop.dataset.over);
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    delete drop.dataset.over;
    const f = e.dataTransfer?.files?.[0];
    if (f) run(f);
  });

  const result = h('div', { class: 'tresult', 'data-testid': 'test-upload-result', hidden: true });
  const historyHost = h('div', { class: 'only-wide' });
  const del = button('ลบรูปทดสอบ', onDelete, { variant: 'secondary', testid: 'test-upload-delete' });
  del.disabled = true;

  body.append(h('div', { class: 'trow' }, pick, del), drop, fileInfo, msg.el, result, historyHost);

  function paintResult(r) {
    const hasCmp = r.jpegBytes !== null && !isJpeg(r.format);
    const thumbLabel = hasCmp ? 'Thumbnail WebP' : `Thumbnail ${isJpeg(r.format) ? 'JPEG' : 'WebP'}`;
    const bars = [
      [`ต้นฉบับ ${kind(r.type)}`, r.orig],
      ...(hasCmp ? [['Thumbnail JPEG', r.jpegBytes]] : []),
      [thumbLabel, r.bytesThumb],
    ];
    const max = Math.max(...bars.map(([, v]) => v), 1);

    const narrow = kv([
      ['ประมวลผล (processing_ms)', `${r.processing} ms`],
      ['รูปแบบที่ได้ (format)', mime(r.format)],
      ['ต้นฉบับ', formatBytes(r.orig)],
      ['ขนาด display', formatBytes(r.bytesDisplay)],
      ['ขนาด thumb', formatBytes(r.bytesThumb)],
      ['เวลาอัปโหลดทั้งหมด', `${fmt1(r.totalMs)} ms`],
      ...(hasCmp ? [
        ['Thumbnail JPEG → WebP', `${formatBytes(r.jpegBytes)} → ${formatBytes(r.bytesThumb)}`],
        ['ประหยัดจาก WebP', h('span', { class: 'tsave' }, `${fmt1(r.savings)}%`)],
      ] : []),
    ]);
    narrow.classList.add('only-narrow');

    const wideTiles = tiles([
      tile('processing_ms', `${r.processing} ms`),
      tile('format', mime(r.format)),
      ...(hasCmp ? [tile('ประหยัดจาก WebP', `${fmt1(r.savings)}%`)] : []),
    ]);
    wideTiles.classList.add('only-wide');
    const wideExtra = kv([
      ['ขนาด display', formatBytes(r.bytesDisplay)],
      ['ขนาด thumb', formatBytes(r.bytesThumb)],
      ['เวลาอัปโหลดทั้งหมด', `${fmt1(r.totalMs)} ms`],
    ]);
    wideExtra.classList.add('only-wide');

    const barRows = h('div', { class: 'tbars only-wide' }, bars.map(([label, v]) => {
      const fill = h('span', { class: 'tbar__fill' });
      fill.style.width = `${Math.max(1, (v / max) * 100)}%`;
      return h('div', { class: 'tbar' },
        h('span', { class: 'tbar__k' }, label),
        h('span', { class: 'tbar__track', 'aria-hidden': 'true' }, fill),
        h('span', { class: 'tbar__v' }, formatBytes(v)));
    }));

    result.replaceChildren(narrow, wideTiles, barRows, wideExtra);
    result.hidden = false;
  }

  function paintHistory() {
    historyHost.replaceChildren(
      h('h3', { class: 'tcard__h3' }, 'ประวัติการทดสอบ'),
      history.length
        ? table(['ไฟล์', 'ต้นฉบับ', 'WebP', 'ประหยัด', 'เวลา'], history.map((r) => [
          r.name,
          formatBytes(r.orig),
          isJpeg(r.format) ? '—' : formatBytes(r.bytesThumb),
          r.jpegBytes !== null && !isJpeg(r.format) ? `${fmt1(r.savings)}%` : '—',
          `${fmt1(r.totalMs)} ms`,
        ]), { caption: 'ประวัติการทดสอบ', testid: 'test-upload-history' })
        : h('p', { class: 'tcard__sub' }, 'ยังไม่มีประวัติ'));
  }
  paintHistory();
  if (history.length) { last = history[0]; paintResult(last); }
  del.disabled = !lastUpload;

  let running = false;
  async function run(file) {
    if (running) return;
    msg.clear();
    if (!(await requireUser())) return;
    running = true;
    pick.setAttribute('aria-busy', 'true');
    fileInfo.textContent = `${file.name} · ${formatBytes(file.size)} · กำลังอัปโหลด…`;
    try {
      const form = new FormData();
      form.append('file', file);
      const t0 = performance.now();
      const img = await api('POST', '/api/images', { form, signal: ctrl.signal });
      const totalMs = performance.now() - t0;
      const format = String(img.format);
      const jpegBytes = isJpeg(format) ? null : await jpegThumbBytes(file);
      if (ctrl.signal.aborted) return;
      last = {
        name: file.name,
        type: file.type,
        orig: file.size,
        processing: img.processing_ms,
        format,
        bytesDisplay: img.bytes_display,
        bytesThumb: img.bytes_thumb,
        totalMs,
        jpegBytes,
        savings: jpegBytes ? (1 - img.bytes_thumb / jpegBytes) * 100 : null,
      };
      history.unshift(last);
      lastUpload = { id: img.id };
      del.disabled = false;
      fileInfo.textContent = `${file.name} · ${formatBytes(file.size)}`;
      paintResult(last);
      paintHistory();
      toast('อัปโหลดสำเร็จ');
    } catch (err) {
      if (err?.name === 'AbortError' || ctrl.signal.aborted) return;
      fileInfo.textContent = `${file.name} · ${formatBytes(file.size)}`;
      if (handleAuthError(err)) return;
      if (err instanceof ApiError && err.status !== 429 && err.status < 500) {
        msg.show(`อัปโหลดไม่สำเร็จ (${err.status} ${err.code})`);
      } else {
        reportApiError(err);
      }
    } finally {
      running = false;
      pick.removeAttribute('aria-busy');
    }
  }

  async function onDelete() {
    if (!lastUpload || !state.me) return;
    del.disabled = true;
    try {
      await api('DELETE', `/api/images/${lastUpload.id}`, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      lastUpload = null;
      toast('ลบรูปทดสอบแล้ว');
    } catch (err) {
      if (err?.name === 'AbortError' || ctrl.signal.aborted) return;
      del.disabled = false;
      if (handleAuthError(err)) return;
      if (err instanceof ApiError && err.status === 404) { lastUpload = null; del.disabled = true; return; }
      reportApiError(err);
    }
  }

  return { root, destroy() { ctrl.abort(); } };
}
