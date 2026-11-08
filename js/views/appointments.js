// Appointments agenda: search + status filters, grouped by day, with calendar export and actions.
import { appointmentStatus, googleCalendarUrl, sortAppointments, toISODate } from '../domain.js';
import { formatDate, formatTime, html, icon } from '../ui.js';

const FILTERS = [
  ['all', 'All'], ['upcoming', 'Upcoming'], ['today', 'Today'], ['missed', 'Missed'], ['completed', 'Attended'],
];
const STATUS_LABEL = { upcoming: 'Upcoming', today: 'Today', missed: 'Missed', completed: 'Attended', cancelled: 'Cancelled' };
const ACTIVE = new Set(['today', 'upcoming']);

function dayHeading(iso, now) {
  const offset = (n) => toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  if (iso === offset(0)) return 'Today';
  if (iso === offset(1)) return 'Tomorrow';
  if (iso === offset(-1)) return 'Yesterday';
  return formatDate(iso, { weekday: 'long', day: 'numeric', month: 'long' });
}

function matches(apt, query) {
  if (!query) return true;
  const hay = `${apt.patientName} ${apt.doctorName} ${apt.title} ${apt.notes}`.toLowerCase();
  return hay.includes(query.toLowerCase());
}

function appointmentCard(apt, status) {
  const calendarUrl = apt.calendarUrl || googleCalendarUrl(apt);
  const canComplete = ['missed', 'today', 'upcoming'].includes(status);
  return html`
    <article class="agenda-item status-${status}">
      <div class="agenda-time"><strong>${formatTime(apt.time)}</strong><span class="badge badge-${status}">${STATUS_LABEL[status]}</span></div>
      <div class="agenda-main">
        <h3>${apt.title}</h3>
        <p class="agenda-meta">${icon('user', 14)} ${apt.patientName} <span aria-hidden="true">·</span> ${apt.doctorName}</p>
        ${apt.notes ? html`<p class="agenda-notes">${apt.notes}</p>` : ''}
        <div class="agenda-actions">
          <a class="chip-btn" href="${calendarUrl}" target="_blank" rel="noopener">${icon('calendar', 14)} Google Calendar</a>
          <button class="chip-btn" data-action="download-ics" data-id="${apt.id}">${icon('download', 14)} .ics</button>
          ${canComplete ? html`<button class="chip-btn" data-action="complete-apt" data-id="${apt.id}">${icon('check', 14)} Mark attended</button>` : ''}
          ${status === 'completed' ? html`<button class="chip-btn chip-accent" data-action="summarize-apt" data-id="${apt.id}">${icon('sparkles', 14)} Summarize visit</button>` : ''}
          <button class="chip-btn chip-danger" data-action="delete-apt" data-id="${apt.id}" aria-label="Delete ${apt.title}">${icon('trash', 14)}</button>
        </div>
      </div>
      ${apt.synced || apt.demo ? '' : html`<span class="pending-dot" title="Waiting to sync"></span>`}
    </article>`;
}

function groupByDate(list) {
  return list.reduce((acc, apt) => {
    const last = acc[acc.length - 1];
    if (last && last.date === apt.date) last.items.push(apt);
    else acc.push({ date: apt.date, items: [apt] });
    return acc;
  }, []);
}

export function renderAppointments(state, { now, filters }) {
  const { query = '', status: statusFilter = 'all' } = filters.appointments || {};
  const statusById = new Map(state.appointments.map((a) => [a.id, appointmentStatus(a, now)]));
  const counts = Object.fromEntries(FILTERS.map(([key]) => [key, key === 'all' ? statusById.size : [...statusById.values()].filter((s) => s === key).length]));
  const visible = state.appointments.filter((a) => (statusFilter === 'all' || statusById.get(a.id) === statusFilter) && matches(a, query));

  // Active visits chronologically first, then past visits most-recent first.
  const active = sortAppointments(visible.filter((a) => ACTIVE.has(statusById.get(a.id))), 'asc');
  const past = sortAppointments(visible.filter((a) => !ACTIVE.has(statusById.get(a.id))), 'desc');
  const groups = groupByDate([...active, ...past]);

  return html`
    <div class="toolbar">
      <label class="search">${icon('search', 16)}<input type="search" placeholder="Search patient, doctor, reason…" value="${query}" data-filter="appointments.query" aria-label="Search appointments"></label>
      <div class="chips" role="group" aria-label="Filter by status">
        ${FILTERS.map(([key, label]) => html`<button class="chip ${statusFilter === key ? 'active' : ''}" aria-pressed="${String(statusFilter === key)}" data-action="set-filter" data-filter="appointments.status" data-value="${key}">${label}<span class="chip-count">${counts[key]}</span></button>`)}
      </div>
    </div>
    ${groups.length ? html`<div class="agenda">${groups.map((g) => html`
      <section class="agenda-day">
        <h2 class="agenda-date">${dayHeading(g.date, now)}</h2>
        ${g.items.map((apt) => appointmentCard(apt, statusById.get(apt.id)))}
      </section>`)}</div>`
      : html`<div class="empty-state">${icon('calendar', 32)}<p>${state.appointments.length ? 'No appointments match these filters.' : 'No appointments yet.'}</p>
        <button class="btn btn-primary" data-action="open-dialog" data-dialog="apt-dialog">${icon('plus')} New appointment</button></div>`}`;
}
