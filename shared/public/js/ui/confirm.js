// Confirm dialog built on openDialog. Resolves true only when the confirm button is pressed;
// Esc, the scrim and the cancel button all resolve false.
import { h } from '../dom.js';
import { openDialog } from './dialog.js';

let seq = 0;

export function confirmDialog({ title, body, confirmText, cancelText = 'ยกเลิก', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const titleId = `confirm-title-${++seq}`;
    let close = () => {};

    const cancelBtn = h('button', {
      type: 'button',
      class: 'btn btn--secondary',
      'data-testid': 'confirm-cancel',
      onclick: () => close(),
    }, cancelText);
    const okBtn = h('button', {
      type: 'button',
      class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
      'data-testid': 'confirm-ok',
      onclick: () => { answer = true; close(); },
    }, confirmText);

    const el = h('div', { class: 'sheet sheet--confirm', 'data-testid': 'confirm-dialog' },
      h('div', { class: 'sheet__grip', 'aria-hidden': 'true' }),
      h('h2', { id: titleId, class: 'sheet__title' }, title),
      body ? h('p', { class: 'sheet__lead' }, body) : null,
      h('div', { class: 'confirm__actions' }, cancelBtn, okBtn));

    // Focus starts on the safe choice so a stray Enter never confirms a destructive action.
    close = openDialog(el, {
      labelledBy: titleId,
      initialFocus: cancelBtn,
      onClose: () => resolve(answer),
    });
  });
}
