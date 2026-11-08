// App shell: boot, lock screen, hash router, render loop and event delegation.
import * as actions from './actions.js';
import { changePin, initAuth, isDefaultPin, startIdleLock, verifyPin } from './auth.js';
import { parseTimes } from './domain.js';
import { buildDemoData } from './seed.js';
import { getSettings, getState, replaceAll, saveSettings, subscribe, update } from './store.js';
import { flush, getStatus, onOpRejected, onStatusChange, pullAll } from './sync.js';
import {
  confirmDialog, downloadFile, enableBackdropClose, formatTime, html, icon, mount, openDialog,
  readForm, showErrors, toast,
} from './ui.js';
import { renderAppointments } from './views/appointments.js';
import { renderMedications } from './views/medications.js';
import { renderOverview } from './views/overview.js';
import { renderReport, reportCsv } from './views/report.js';
import { renderSettings } from './views/settings.js';
import { renderSummaries } from './views/summaries.js';

const ROUTES = {
  overview: { title: 'Overview', render: renderOverview },
  appointments: { title: 'Appointments', sub: 'Visits, calendar sync and attendance', cta: ['apt-dialog', 'New appointment'], render: renderAppointments },
  medications: { title: 'Medicines', sub: 'Daily dose checklist and SMS reminders', cta: ['med-dialog', 'Add medicine'], render: renderMedications },
  summaries: { title: 'AI Visit Summaries', sub: 'Doctor notes in plain language, powered by Llama 3.3 70B', cta: ['ai-dialog', 'New summary'], render: renderSummaries },
  report: { title: 'Health Report', sub: 'Printable record to share with your doctor', render: renderReport },
  settings: { title: 'Settings', sub: 'Cloud, security, appearance and data', render: renderSettings },
};

const ui = {
  filters: { appointments: { query: '', status: 'all' }, report: { patient: '' } },
  medTimes: ['08:00'],
  unlocked: false,
  stopIdle: null,
};

const $ = (sel) => document.querySelector(sel);
const currentRoute = () => (ROUTES[location.hash.slice(1)] ? location.hash.slice(1) : 'overview');

// ---- Theme ------------------------------------------------------------------------------
function isDarkActive() {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr ? attr === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme = getSettings().theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const dark = isDarkActive();
  mount($('#theme-toggle'), icon(dark ? 'sun' : 'moon'));
  $('#theme-toggle').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}

// ---- Rendering --------------------------------------------------------------------------
const SYNC_PILL = { online: ['Synced', 'ok'], syncing: ['Syncing', 'busy'], offline: ['Offline', 'warn'], limited: ['Cloud (legacy)', 'warn'], local: ['Local mode', 'muted'], idle: ['Connecting', 'busy'] };

function renderSyncPill(status) {
  const [label, tone] = SYNC_PILL[status.state] || SYNC_PILL.idle;
  const pending = getState().outbox.length;
  mount($('#sync-pill'), html`<a href="#settings" class="status-pill tone-${tone}" title="${status.detail || label}"><span class="dot"></span>${label}${pending ? ` · ${pending} pending` : ''}</a>`);
}

function viewContext(state) {
  return {
    now: new Date(),
    filters: ui.filters,
    settings: getSettings(),
    syncStatus: getStatus(),
    isDefaultPin: isDefaultPin(),
    demoCount: ['appointments', 'medications', 'summaries'].reduce((n, k) => n + state[k].filter((x) => x.demo).length, 0),
  };
}

function render() {
  if (!ui.unlocked) return;
  const route = currentRoute();
  const def = ROUTES[route];
  const active = document.activeElement;
  const focusFilter = active?.dataset?.filter;
  const caret = active?.selectionStart;

  document.querySelectorAll('[data-route]').forEach((a) => a.setAttribute('aria-current', a.dataset.route === route ? 'page' : 'false'));
  $('#page-title').textContent = def.title;
  $('#page-sub').textContent = def.sub || '';
  $('#page-sub').hidden = !def.sub;
  mount($('#page-cta'), def.cta ? html`<button class="btn btn-primary" data-action="open-dialog" data-dialog="${def.cta[0]}">${icon('plus')}<span>${def.cta[1]}</span></button>` : '');

  const state = getState();
  const view = $('#view');
  mount(view, def.render(state, viewContext(state)));
  view.dataset.route = route;

  if (focusFilter) {
    const el = view.querySelector(`[data-filter="${focusFilter}"]`);
    if (el) {
      el.focus();
      if (typeof caret === 'number' && el.setSelectionRange) el.setSelectionRange(caret, caret);
    }
  }
}

function renderMedTimes() {
  mount($('#med-times'), ui.medTimes.length
    ? ui.medTimes.map((t) => html`<span class="time-chip is-taken">${formatTime(t)}<button type="button" class="chip-x" data-action="remove-med-time" data-value="${t}" aria-label="Remove ${t}">${icon('x', 12)}</button></span>`)
    : html`<span class="muted small">No times yet, add at least one.</span>`);
  document.querySelectorAll('[data-action="preset-time"]').forEach((b) => b.setAttribute('aria-pressed', String(ui.medTimes.includes(b.dataset.value))));
}

// ---- Lock screen ------------------------------------------------------------------------
let pinBuffer = '';
let pinBusy = false;

function renderPinDots(state = '') {
  const dots = $('#pin-dots');
  dots.className = `pin-dots ${state}`;
  mount(dots, Array.from({ length: 4 }, (_, i) => html`<span class="${i < pinBuffer.length ? 'filled' : ''}"></span>`));
}

async function tryUnlock() {
  pinBusy = true;
  const result = await verifyPin(pinBuffer);
  pinBuffer = '';
  pinBusy = false;
  if (result.ok) {
    renderPinDots('ok');
    setTimeout(unlock, 180);
    return;
  }
  renderPinDots('error');
  $('#pin-msg').textContent = result.lockedForMs
    ? `Too many attempts. Try again in ${Math.ceil(result.lockedForMs / 1000)}s.`
    : `Incorrect PIN. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left.`;
}

function pressPin(digit) {
  if (pinBusy || pinBuffer.length >= 4) return;
  pinBuffer += digit;
  renderPinDots();
  if (pinBuffer.length === 4) tryUnlock();
}

function unlock() {
  ui.unlocked = true;
  document.body.classList.remove('is-locked');
  $('#lock-screen').hidden = true;
  $('#app').hidden = false;
  render();
  renderSyncPill(getStatus());
  pullAll();
  ui.stopIdle = startIdleLock(() => lock('Locked after 5 minutes of inactivity'));
}

function lock(message = 'Enter your PIN to continue') {
  ui.unlocked = false;
  ui.stopIdle?.();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  document.body.classList.add('is-locked');
  $('#app').hidden = true;
  $('#lock-screen').hidden = false;
  $('#pin-msg').textContent = message;
  $('#pin-hint').hidden = !isDefaultPin();
  pinBuffer = '';
  renderPinDots();
}

// ---- Data management --------------------------------------------------------------------
function loadDemo() {
  const demo = buildDemoData();
  update((s) => ({
    appointments: [...demo.appointments, ...s.appointments.filter((x) => !x.demo)],
    medications: [...demo.medications, ...s.medications.filter((x) => !x.demo)],
    doseLogs: [...demo.doseLogs, ...s.doseLogs.filter((x) => !x.demo)],
    summaries: [...demo.summaries, ...s.summaries.filter((x) => !x.demo)],
  }));
  toast('Sample week loaded. It stays on this device and never syncs', { type: 'success' });
}

function clearDemo() {
  update((s) => Object.fromEntries(['appointments', 'medications', 'doseLogs', 'summaries'].map((k) => [k, s[k].filter((x) => !x.demo)])));
  toast('Sample data removed');
}

function exportJson() {
  const { appointments, medications, doseLogs, summaries } = getState();
  const stamp = new Date().toISOString().slice(0, 10);
  const payload = { app: 'rk-health', version: 2, exportedAt: new Date().toISOString(), appointments, medications, doseLogs, summaries };
  downloadFile(`rk-health-backup-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast('Backup downloaded', { type: 'success' });
}

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data?.app !== 'rk-health' || !Array.isArray(data.appointments)) throw new Error('not an RK Health backup file');
    const ok = await confirmDialog({ title: 'Import backup?', message: 'This replaces the records on this device with the backup file.', confirmLabel: 'Import' });
    if (!ok) return;
    replaceAll({ appointments: data.appointments, medications: data.medications || [], doseLogs: data.doseLogs || [], summaries: data.summaries || [] });
    toast('Backup imported', { type: 'success' });
  } catch (error) {
    toast(`Import failed: ${error.message}`, { type: 'error' });
  }
}

async function clearLocal() {
  const ok = await confirmDialog({
    title: 'Clear data on this device?',
    message: 'Removes every record stored in this browser. Records already saved to Google Sheets stay in the cloud. This cannot be undone.',
    confirmLabel: 'Clear data',
    danger: true,
  });
  if (!ok) return;
  replaceAll({});
  toast('Local data cleared');
}

async function saveApi(form) {
  const { apiUrl } = readForm(form);
  if (apiUrl && !/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(apiUrl)) {
    showErrors(form, { apiUrl: 'Paste the Apps Script Web App URL ending in /exec' });
    return;
  }
  saveSettings({ apiUrl });
  const ok = await pullAll();
  const { state, detail } = getStatus();
  if (!apiUrl) toast('Local mode on. Data stays on this device');
  else if (ok) toast('Connected. Records synced with Google Sheets', { type: 'success' });
  else toast(detail || `Connection: ${state}`, { type: state === 'limited' ? 'info' : 'error' });
  render();
}

async function savePin(form) {
  const { currentPin, newPin, confirmPin } = readForm(form);
  if (newPin !== confirmPin) {
    showErrors(form, { confirmPin: 'PINs do not match' });
    return;
  }
  const result = await changePin(currentPin, newPin);
  if (!result.ok) {
    const field = /current|attempts/i.test(result.error) ? 'currentPin' : 'newPin';
    showErrors(form, { [field]: result.error });
    return;
  }
  form.reset();
  toast('PIN updated', { type: 'success' });
  render();
}

// ---- Event delegation -------------------------------------------------------------------
function setFilter(key, value) {
  const [group, field] = key.split('.');
  ui.filters = { ...ui.filters, [group]: { ...ui.filters[group], [field]: value } };
  render();
}

const CLICK_ACTIONS = {
  'open-dialog': (el) => {
    if (el.dataset.dialog === 'med-dialog') {
      ui.medTimes = ['08:00'];
      renderMedTimes();
    }
    if (el.dataset.dialog === 'ai-dialog') $('#ai-form').elements.appointmentId.value = '';
    openDialog(el.dataset.dialog);
  },
  'set-filter': (el) => setFilter(el.dataset.filter, el.dataset.value),
  'toggle-dose': (el) => actions.toggleDose(el.dataset),
  'complete-apt': (el) => actions.completeAppointment(el.dataset.id),
  'delete-apt': (el) => actions.deleteAppointment(el.dataset.id),
  'download-ics': (el) => actions.downloadIcs(el.dataset.id),
  'summarize-apt': (el) => actions.openSummaryFor(el.dataset.id),
  'toggle-med': (el) => actions.toggleMedicationActive(el.dataset.id),
  'delete-med': (el) => actions.deleteMedication(el.dataset.id),
  'send-sms': (el) => actions.sendSmsNow(el.dataset.id, el),
  'copy-summary': (el) => actions.copySummary(el.dataset.id),
  'delete-summary': (el) => actions.deleteSummary(el.dataset.id),
  'preset-time': (el) => {
    const t = el.dataset.value;
    ui.medTimes = ui.medTimes.includes(t) ? ui.medTimes.filter((x) => x !== t) : parseTimes([...ui.medTimes, t]);
    renderMedTimes();
  },
  'add-med-time': () => {
    const input = $('#med-custom-time');
    if (!input.value) return;
    ui.medTimes = parseTimes([...ui.medTimes, input.value]);
    input.value = '';
    renderMedTimes();
  },
  'remove-med-time': (el) => {
    ui.medTimes = ui.medTimes.filter((x) => x !== el.dataset.value);
    renderMedTimes();
  },
  'export-csv': () => {
    downloadFile(`rk-health-report-${new Date().toISOString().slice(0, 10)}.csv`, reportCsv(getState(), ui.filters.report.patient), 'text/csv');
    toast('Report exported as CSV', { type: 'success' });
  },
  'export-json': exportJson,
  print: () => window.print(),
  'load-demo': loadDemo,
  'clear-demo': clearDemo,
  'clear-local': clearLocal,
  'set-theme': (el) => {
    saveSettings({ theme: el.dataset.value });
    applyTheme();
    render();
  },
  'toggle-theme': () => {
    saveSettings({ theme: isDarkActive() ? 'light' : 'dark' });
    applyTheme();
    if (currentRoute() === 'settings') render();
  },
  'sync-now': async () => {
    const ok = await pullAll();
    toast(ok ? 'Synced with Google Sheets' : getStatus().detail || 'Sync unavailable', { type: ok ? 'success' : 'error' });
  },
  lock: () => lock('Locked'),
  'pin-key': (el) => pressPin(el.dataset.value),
  'pin-back': () => {
    pinBuffer = pinBuffer.slice(0, -1);
    renderPinDots();
  },
};

const FORM_SUBMITS = {
  'apt-form': (form) => actions.submitAppointment(form),
  'med-form': (form) => actions.submitMedication(form, ui.medTimes),
  'ai-form': (form) => actions.submitSummary(form),
  'api-form': saveApi,
  'pin-form': savePin,
};

function bindChartTooltips() {
  const showTip = (event) => {
    const bar = event.target.closest?.('.bar-group');
    const wrap = bar?.closest('.chart-wrap');
    if (!bar || !wrap) return;
    const tip = wrap.querySelector('.chart-tip');
    const box = bar.getBoundingClientRect();
    const host = wrap.getBoundingClientRect();
    tip.textContent = bar.dataset.tip;
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(box.left - host.left + box.width / 2, 80), host.width - 80)}px`;
  };
  const hideTip = (event) => {
    const wrap = event.target.closest?.('.chart-wrap');
    if (wrap) wrap.querySelector('.chart-tip').hidden = true;
  };
  document.addEventListener('pointerover', showTip);
  document.addEventListener('focusin', showTip);
  document.addEventListener('pointerout', hideTip);
  document.addEventListener('focusout', hideTip);
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT') return;
    const handler = CLICK_ACTIONS[el.dataset.action];
    if (handler) {
      event.preventDefault();
      handler(el);
    }
  });

  document.addEventListener('submit', (event) => {
    const handler = FORM_SUBMITS[event.target.id];
    if (!handler || event.submitter?.value === 'cancel') return; // let <dialog> close
    event.preventDefault();
    handler(event.target);
  });

  document.addEventListener('input', (event) => {
    const key = event.target.dataset?.filter;
    if (key && event.target.tagName !== 'SELECT') setFilter(key, event.target.value);
  });

  document.addEventListener('change', (event) => {
    const { target } = event;
    if (target.tagName === 'SELECT' && target.dataset.filter) setFilter(target.dataset.filter, target.value);
    if (target.dataset?.change === 'import-json' && target.files?.[0]) {
      importJson(target.files[0]);
      target.value = '';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (ui.unlocked) return;
    if (/^\d$/.test(event.key)) pressPin(event.key);
    if (event.key === 'Backspace') CLICK_ACTIONS['pin-back']();
  });

  window.addEventListener('hashchange', () => {
    render();
    $('#view').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  window.addEventListener('online', () => pullAll());
  window.addEventListener('offline', () => renderSyncPill({ state: 'offline', detail: 'No internet connection' }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
  bindChartTooltips();
  enableBackdropClose();
}

// ---- Boot -------------------------------------------------------------------------------
async function boot() {
  applyTheme();
  bindEvents();
  subscribe(() => {
    render();
    renderSyncPill(getStatus());
  });
  onStatusChange((status) => {
    renderSyncPill(status);
    if (currentRoute() === 'settings' && !document.activeElement?.closest('form')) render();
  });
  onOpRejected((op, error) => toast(`Cloud rejected a change (${op.action}): ${error.message}`, { type: 'error', duration: 7000 }));

  const idle = () => ui.unlocked && !document.querySelector('dialog[open]') && !document.activeElement?.matches('input, textarea, select');
  setInterval(() => { if (idle()) render(); }, 60_000); // statuses/countdowns change with time
  setInterval(() => { if (getState().outbox.length) flush(); }, 30_000); // retry queued writes

  await initAuth();
  lock(isDefaultPin() ? 'Enter your 4-digit PIN' : 'Welcome back. Enter your PIN');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* PWA is optional */ });
  }
}

boot();
