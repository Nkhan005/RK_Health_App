// Settings: cloud backend, security PIN, appearance, data management and system architecture.
import { APP_VERSION } from '../config.js';
import { html, icon } from '../ui.js';

const STATUS_COPY = {
  online: ['Connected', 'ok'],
  syncing: ['Syncing…', 'busy'],
  offline: ['Offline', 'warn'],
  limited: ['Connected (legacy backend)', 'warn'],
  local: ['Local only', 'muted'],
  idle: ['Not checked yet', 'muted'],
};

const STACK = [
  ['Frontend', 'HTML5, modern CSS (custom properties, grid, native <dialog>), vanilla ES modules. Zero dependencies, no build step.'],
  ['State', 'Immutable store + localStorage cache, offline outbox queue with retry, optimistic UI.'],
  ['Backend', 'Google Apps Script Web App (action router, input validation, LockService for safe concurrent writes).'],
  ['Database', 'Google Sheets: Appointments, Medications, DoseLogs, Summaries tabs.'],
  ['Integrations', 'Google Calendar links + .ics export, Twilio SMS (scheduled trigger), Groq Llama 3.3 70B summaries.'],
  ['Security', 'Secrets in Apps Script Script Properties (never in the browser), salted SHA-256 PIN, idle auto-lock, XSS-safe templating.'],
  ['Delivery', 'GitHub Pages + installable PWA with service worker (works offline).'],
];

export function renderSettings(state, { settings, syncStatus, isDefaultPin, demoCount }) {
  const [statusLabel, tone] = STATUS_COPY[syncStatus.state] || STATUS_COPY.idle;
  const lastSync = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString() : 'Never';
  return html`
    <div class="settings-grid">
      <section class="panel">
        <header class="panel-head"><h3>${icon('cloud', 18)} Cloud backend</h3><span class="status-pill tone-${tone}"><span class="dot"></span>${statusLabel}</span></header>
        <p class="muted small">${syncStatus.detail || 'Google Apps Script Web App that stores your records in Google Sheets.'}</p>
        <form id="api-form" class="stack" novalidate>
          <label class="field"><span>Web App URL</span>
            <input name="apiUrl" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${settings.apiUrl}" spellcheck="false">
            <small class="hint">Leave empty to run fully on this device (local mode).</small>
            <span class="field-error" data-for="apiUrl"></span>
          </label>
          <div class="row-actions">
            <button class="btn btn-primary" type="submit">Save &amp; test connection</button>
            <button class="btn btn-ghost" type="button" data-action="sync-now">${icon('refresh', 16)} Sync now</button>
          </div>
        </form>
        <dl class="kv">
          <div><dt>Last full sync</dt><dd>${lastSync}</dd></div>
          <div><dt>Changes waiting to upload</dt><dd>${state.outbox.length}</dd></div>
        </dl>
      </section>

      <section class="panel">
        <header class="panel-head"><h3>${icon('lock', 18)} Security PIN</h3>${isDefaultPin ? html`<span class="status-pill tone-warn"><span class="dot"></span>Demo PIN in use</span>` : html`<span class="status-pill tone-ok"><span class="dot"></span>Custom PIN</span>`}</header>
        <p class="muted small">Your PIN is stored only as a salted SHA-256 hash. 5 wrong attempts lock the app for 30 seconds, and it auto-locks after 5 minutes of inactivity.</p>
        <form id="pin-form" class="stack" novalidate>
          <label class="field"><span>Current PIN</span><input name="currentPin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6"><span class="field-error" data-for="currentPin"></span></label>
          <div class="field-row">
            <label class="field"><span>New PIN</span><input name="newPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6"><span class="field-error" data-for="newPin"></span></label>
            <label class="field"><span>Confirm</span><input name="confirmPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6"><span class="field-error" data-for="confirmPin"></span></label>
          </div>
          <div class="row-actions"><button class="btn btn-primary" type="submit">Update PIN</button></div>
        </form>
      </section>

      <section class="panel">
        <header class="panel-head"><h3>${icon('sun', 18)} Appearance</h3></header>
        <div class="segmented" role="radiogroup" aria-label="Theme">
          ${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([value, label]) => html`
            <button role="radio" aria-checked="${String(settings.theme === value)}" class="${settings.theme === value ? 'active' : ''}" data-action="set-theme" data-value="${value}">${label}</button>`)}
        </div>
      </section>

      <section class="panel">
        <header class="panel-head"><h3>${icon('report', 18)} Your data</h3></header>
        <div class="data-actions">
          ${demoCount
            ? html`<button class="btn btn-ghost" data-action="clear-demo">${icon('x', 16)} Remove sample data (${demoCount})</button>`
            : html`<button class="btn btn-ghost" data-action="load-demo">${icon('sparkles', 16)} Load sample week</button>`}
          <button class="btn btn-ghost" data-action="export-json">${icon('download', 16)} Export backup</button>
          <label class="btn btn-ghost file-btn">${icon('refresh', 16)} Import backup<input type="file" accept="application/json" data-change="import-json" hidden></label>
          <button class="btn btn-danger-ghost" data-action="clear-local">${icon('trash', 16)} Clear data on this device</button>
        </div>
      </section>

      <section class="panel panel-wide">
        <header class="panel-head"><h3>${icon('heart', 18)} How RK Health works</h3><span class="muted small">v${APP_VERSION}</span></header>
        <dl class="stack-list">${STACK.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
      </section>
    </div>`;
}
