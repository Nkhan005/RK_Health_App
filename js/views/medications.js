// Medications: per-medicine cards with today's dose toggles, 7-day history strip and SMS controls.
import { dosesForDay, medicationAdherence, parseTimes } from '../domain.js';
import { formatDate, formatTime, html, icon } from '../ui.js';

function historyStrip(med, logs, now) {
  const { byDay, pct } = medicationAdherence([med], logs, 7, now);
  return html`
    <div class="history" aria-label="Last 7 days: ${pct ?? 'no'} percent taken">
      ${byDay.map((d) => {
        const state = d.scheduled === 0 ? 'none' : d.taken === d.scheduled ? 'full' : d.taken > 0 ? 'partial' : 'missed';
        const label = { none: 'not due', full: 'all taken', partial: 'some taken', missed: 'missed' }[state];
        return html`<span class="hist-cell hist-${state}" title="${formatDate(d.date)}: ${label}"><span class="sr-only">${formatDate(d.date)}: ${label}</span></span>`;
      })}
      <span class="hist-pct">${pct === null ? '—' : `${pct}%`}</span>
    </div>`;
}

function medicationCard(med, state, now) {
  const today = dosesForDay([med], state.doseLogs, now, now);
  const paused = med.active === false;
  return html`
    <article class="med-card ${paused ? 'is-paused' : ''}">
      <header class="med-head">
        <span class="med-icon">${icon('pill', 20)}</span>
        <div>
          <h3>${med.medicineName}</h3>
          <p class="muted">${med.dosage}</p>
        </div>
        ${paused ? html`<span class="badge badge-cancelled">Paused</span>` : ''}
      </header>

      <div class="med-section">
        <span class="label">Today</span>
        <div class="time-chips">
          ${paused || !today.length
            ? parseTimes(med.times ?? med.timing).map((t) => html`<span class="time-chip is-static">${formatTime(t)}</span>`)
            : today.map((d) => html`<button class="time-chip ${d.taken ? 'is-taken' : d.overdue ? 'is-overdue' : ''}" data-action="toggle-dose" data-id="${med.id}" data-date="${d.date}" data-time="${d.time}" aria-pressed="${String(d.taken)}" aria-label="${d.taken ? 'Taken' : 'Mark taken'}: ${formatTime(d.time)}">
                ${d.taken ? icon('check', 14) : icon('clock', 14)} ${formatTime(d.time)}</button>`)}
        </div>
      </div>

      <div class="med-section">
        <span class="label">Last 7 days</span>
        ${historyStrip(med, state.doseLogs, now)}
      </div>

      <footer class="med-foot">
        <span class="sms-state ${med.phoneNumber ? 'on' : ''}">${icon('message', 14)} ${med.phoneNumber ? `SMS to ${med.phoneNumber}` : 'SMS off'}</span>
        <div class="med-actions">
          ${med.phoneNumber && !paused ? html`<button class="chip-btn" data-action="send-sms" data-id="${med.id}">Send reminder now</button>` : ''}
          <button class="chip-btn" data-action="toggle-med" data-id="${med.id}">${paused ? 'Resume' : 'Pause'}</button>
          <button class="chip-btn chip-danger" data-action="delete-med" data-id="${med.id}" aria-label="Delete ${med.medicineName}">${icon('trash', 14)}</button>
        </div>
      </footer>
    </article>`;
}

export function renderMedications(state, { now }) {
  if (!state.medications.length) {
    return html`<div class="empty-state">${icon('pill', 32)}<p>No medicines yet. Add one to get a daily dose checklist and SMS reminders.</p>
      <button class="btn btn-primary" data-action="open-dialog" data-dialog="med-dialog">${icon('plus')} Add medicine</button></div>`;
  }
  const sorted = [...state.medications].sort((a, b) => Number(a.active === false) - Number(b.active === false));
  return html`
    <p class="legend-line"><span class="hist-cell hist-full"></span> all taken <span class="hist-cell hist-partial"></span> some taken <span class="hist-cell hist-missed"></span> missed <span class="hist-cell hist-none"></span> not due</p>
    <div class="med-grid">${sorted.map((m) => medicationCard(m, state, now))}</div>`;
}
