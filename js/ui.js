// UI toolkit: XSS-safe templating, icons, toasts (with undo), native <dialog> modals,
// confirm prompts, inline form validation and file downloads. No framework needed.
import { escapeHtml } from './domain.js';

const RAW = Symbol('raw');

/** Mark a string as trusted HTML (only for markup we generate ourselves). */
export function raw(markup) {
  return { [RAW]: String(markup) };
}

function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (typeof value === 'object' && RAW in value) return value[RAW];
  return escapeHtml(value);
}

/** Tagged template: every interpolated value is HTML-escaped unless wrapped in raw()/html``. */
export function html(strings, ...values) {
  return raw(strings.reduce((out, chunk, i) => out + chunk + (i < values.length ? renderValue(values[i]) : ''), ''));
}

export function mount(element, template) {
  element.innerHTML = renderValue(template);
}

// ---- Icons (inline SVG, stroke = currentColor so they theme automatically) ----------------
const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  report: '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  lock: '<rect x="4" y="10.5" width="16" height="11" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
  cloud: '<path d="M17.5 19H7a5 5 0 1 1 .9-9.9A6 6 0 0 1 19.5 11a4 4 0 0 1-2 8z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 13a1.5 1.5 0 0 0 1.5 1.4h8a1.5 1.5 0 0 0 1.5-1.4l1-13M9 7V4h6v3"/>',
  download: '<path d="M12 3v12M7 10.5l5 5 5-5M4 20.5h16"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
  message: '<path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.6A8.5 8.5 0 1 1 21 12z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>',
  printer: '<path d="M6.5 9V3h11v6M6.5 17.5h-2a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2h-2"/><rect x="6.5" y="14" width="11" height="7.5" rx="1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  refresh: '<path d="M20.5 12A8.5 8.5 0 0 1 6 18M3.5 12A8.5 8.5 0 0 1 18 6M18 2v4h-4M6 22v-4h4"/>',
  heart: '<path d="M12 20.5s-8.5-5-8.5-11A4.75 4.75 0 0 1 12 6.6a4.75 4.75 0 0 1 8.5 2.9c0 6-8.5 11-8.5 11z"/><path d="M3.5 12h4l2-3 3 6 2-3h6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
};

export function icon(name, size = 18) {
  return raw(`<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`);
}

// ---- Toasts -----------------------------------------------------------------------------
/**
 * @param {string} message
 * @param {{type?: 'success'|'error'|'info', action?: {label: string, run: () => void}, duration?: number}} [options]
 */
export function toast(message, { type = 'info', action = null, duration = 4000 } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const iconName = { error: 'x', success: 'check', info: 'heart' }[type] || 'heart';
  mount(el, html`
    <span class="toast-icon">${icon(iconName, 16)}</span>
    <span class="toast-msg">${message}</span>
    ${action ? html`<button type="button" class="toast-action">${action.label}</button>` : ''}
  `);
  const dismiss = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  if (action) {
    el.querySelector('.toast-action').addEventListener('click', () => {
      action.run();
      dismiss();
    });
  }
  region.appendChild(el);
  setTimeout(dismiss, action ? Math.max(duration, 6000) : duration);
}

// ---- Dialogs ----------------------------------------------------------------------------
export function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!dialog) return null;
  const form = dialog.querySelector('form');
  if (form) clearErrors(form);
  dialog.showModal();
  dialog.querySelector('[autofocus], input:not([type=hidden]), textarea, select')?.focus();
  return dialog;
}

export function closeDialog(id) {
  document.getElementById(id)?.close();
}

/** Close any <dialog> when its backdrop is clicked. */
export function enableBackdropClose() {
  document.addEventListener('click', (event) => {
    if (event.target instanceof HTMLDialogElement) event.target.close();
  });
}

/** Promise-based confirm built on <dialog> (replaces window.confirm). */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  const dialog = document.getElementById('confirm-dialog');
  mount(dialog.querySelector('.confirm-body'), html`<h3>${title}</h3><p>${message}</p>`);
  const ok = dialog.querySelector('[data-confirm]');
  ok.textContent = confirmLabel;
  ok.className = danger ? 'btn btn-danger' : 'btn btn-primary';
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
  });
}

// ---- Forms ------------------------------------------------------------------------------
export function readForm(form) {
  return Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
}

export function clearErrors(form) {
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
}

/** Show inline validation messages and focus the first invalid field. */
export function showErrors(form, errors) {
  clearErrors(form);
  const names = Object.keys(errors);
  names.forEach((name) => {
    const input = form.elements.namedItem(name);
    if (input && 'setAttribute' in input) input.setAttribute('aria-invalid', 'true');
    const slot = form.querySelector(`.field-error[data-for="${name}"]`);
    if (slot) slot.textContent = errors[name];
  });
  const first = names.length ? form.elements.namedItem(names[0]) : null;
  if (first && 'focus' in first) first.focus();
}

export function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${escapeHtml(label || 'Working…')}`;
    button.disabled = true;
  } else {
    button.innerHTML = button.dataset.label || button.innerHTML;
    button.disabled = false;
  }
}

export function downloadFile(filename, content, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

export function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
