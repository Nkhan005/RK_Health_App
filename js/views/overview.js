// Overview dashboard: today's doses, next appointment, adherence trend, latest AI summary.
import {
  appointmentAttendance, appointmentStatus, dosesForDay, escapeHtml, medicationAdherence,
  nextAppointment, parseSummarySections, relativeTime, sortAppointments, toDateTime,
} from '../domain.js';
import { formatDate, formatTime, html, icon, raw } from '../ui.js';
import { LIMITS } from '../config.js';

function greeting(now) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Progress ring (single value, so no legend: the label names it). */
function ring(pct, size = 144) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const value = pct ?? 0;
  return raw(`<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Seven day adherence ${pct ?? 'no data'} percent">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-value" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - value / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`);
}

/** Bar path with 4px rounded top corners anchored to the baseline. */
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function adherenceChart(byDay) {
  const W = 340;
  const H = 150;
  const top = 18;
  const base = H - 26;
  const slot = W / byDay.length;
  const barW = Math.min(30, slot - 14);
  const plotH = base - top;
  const bars = byDay.map((d, i) => {
    const x = i * slot + (slot - barW) / 2;
    const h = d.pct === null ? 0 : Math.max(3, (d.pct / 100) * plotH);
    const isToday = i === byDay.length - 1;
    const day = formatDate(d.date, { weekday: 'short' });
    const tip = d.pct === null ? `${day}: no doses due` : `${day}: ${d.taken} of ${d.scheduled} doses (${d.pct}%)`;
    return `<g class="bar-group" tabindex="0" data-tip="${escapeHtml(tip)}">
      <rect class="bar-hit" x="${i * slot}" y="0" width="${slot}" height="${H}" fill="transparent"/>
      ${d.pct === null
        ? `<line x1="${x + 6}" x2="${x + barW - 6}" y1="${base - 2}" y2="${base - 2}" class="bar-empty"/>`
        : `<path d="${barPath(x, base - h, barW, h)}" class="bar ${isToday ? 'bar-today' : ''}"/>`}
      ${isToday && d.pct !== null ? `<text x="${x + barW / 2}" y="${base - h - 6}" class="bar-label">${d.pct}%</text>` : ''}
      <text x="${x + barW / 2}" y="${H - 8}" class="axis-label">${escapeHtml(day.slice(0, 2))}</text>
    </g>`;
  }).join('');
  const goalY = base - 0.8 * plotH;
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily medication adherence for the last seven days">
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="axis-line"/>
    <line x1="0" x2="${W}" y1="${goalY}" y2="${goalY}" class="goal-line"/>
    <text x="${W}" y="${goalY - 5}" class="goal-label" text-anchor="end">80% goal</text>
    ${bars}
  </svg>`);
}

function doseRow(dose) {
  const state = dose.taken ? 'taken' : dose.overdue ? 'overdue' : 'due';
  const buttonText = { taken: 'Taken', overdue: 'Take now', due: 'Mark taken' }[state];
  return html`
    <li class="dose dose-${state}">
      <span class="dose-time">${formatTime(dose.time)}</span>
      <span class="dose-dot" aria-hidden="true"></span>
      <div class="dose-body">
        <strong>${dose.medication.medicineName}</strong>
        <span>${dose.medication.dosage}</span>
      </div>
      <button type="button" class="dose-toggle" data-action="toggle-dose"
        data-id="${dose.medication.id}" data-date="${dose.date}" data-time="${dose.time}"
        aria-pressed="${String(dose.taken)}" aria-label="${dose.taken ? 'Undo' : 'Mark as taken'}: ${dose.medication.medicineName} at ${dose.time}">
        ${dose.taken ? icon('check', 16) : ''}<span>${buttonText}</span>
      </button>
    </li>`;
}

function emptyOverview() {
  return html`
    <section class="empty-hero">
      <div class="empty-art">${icon('heart', 44)}</div>
      <h2 class="display">Your health, in one calm place</h2>
      <p>Add an appointment or a medicine to get started, or load a realistic sample week to explore every feature.</p>
      <div class="empty-actions">
        <button class="btn btn-primary" data-action="open-dialog" data-dialog="apt-dialog">${icon('calendar')} New appointment</button>
        <button class="btn btn-ghost" data-action="open-dialog" data-dialog="med-dialog">${icon('pill')} Add medicine</button>
        <button class="btn btn-ghost" data-action="load-demo">${icon('sparkles')} Load sample week</button>
      </div>
    </section>`;
}

export function renderOverview(state, { now }) {
  const { appointments, medications, doseLogs, summaries } = state;
  if (!appointments.length && !medications.length && !summaries.length) return emptyOverview();

  const doses = dosesForDay(medications, doseLogs, now, now);
  const takenToday = doses.filter((d) => d.taken).length;
  const left = doses.length - takenToday;
  const adherence = medicationAdherence(medications, doseLogs, LIMITS.adherenceDays, now);
  const attendance = appointmentAttendance(appointments, now);
  const next = nextAppointment(appointments, now);
  const upcoming = sortAppointments(appointments).filter((a) => ['upcoming', 'today'].includes(appointmentStatus(a, now))).slice(0, 3);
  const latest = [...summaries].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const nextDose = doses.find((d) => !d.taken && !d.overdue);
  const pctMark = (v) => (v === null ? '' : raw('<small>%</small>'));

  return html`
    <section class="hero-band">
      <div>
        <p class="eyebrow">${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h2 class="display">${greeting(now)}.</h2>
        <p class="hero-sub">
          ${doses.length ? html`You have <strong>${left}</strong> dose${left === 1 ? '' : 's'} left today` : 'No doses scheduled today'}${next ? html` and your next visit is <strong>${relativeTime(toDateTime(next.date, next.time), now)}</strong>.` : '.'}
        </p>
      </div>
      <div class="hero-ring">
        ${ring(adherence.pct)}
        <div class="ring-center"><span class="ring-num">${adherence.pct ?? '–'}${pctMark(adherence.pct)}</span><span class="ring-cap">7-day adherence</span></div>
      </div>
    </section>

    <section class="kpis" aria-label="Key numbers">
      <article class="kpi">
        <span class="kpi-label">${icon('pill', 16)} Doses today</span>
        <span class="kpi-value">${takenToday}<small>/${doses.length}</small></span>
        <span class="kpi-foot">${nextDose ? `Next: ${nextDose.medication.medicineName} at ${formatTime(nextDose.time)}` : doses.length ? 'Nothing else due' : 'Nothing scheduled'}</span>
      </article>
      <article class="kpi">
        <span class="kpi-label">${icon('calendar', 16)} Next visit</span>
        <span class="kpi-value kpi-text">${next ? formatDate(next.date, { day: 'numeric', month: 'short' }) : '—'}</span>
        <span class="kpi-foot">${next ? `${next.doctorName} · ${formatTime(next.time)}` : 'No upcoming visits'}</span>
      </article>
      <article class="kpi">
        <span class="kpi-label">${icon('check', 16)} Visit attendance</span>
        <span class="kpi-value">${attendance.pct ?? '–'}${pctMark(attendance.pct)}</span>
        <span class="kpi-foot">${attendance.completed} attended · ${attendance.missed} missed</span>
      </article>
      <article class="kpi">
        <span class="kpi-label">${icon('sparkles', 16)} AI summaries</span>
        <span class="kpi-value">${summaries.length}</span>
        <span class="kpi-foot">${latest ? `Latest ${new Date(latest.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'None yet'}</span>
      </article>
    </section>

    <section class="bento">
      <article class="panel panel-doses">
        <header class="panel-head"><h3>Today's medicines</h3><a href="#medications" class="link">Manage ${icon('arrow', 14)}</a></header>
        ${doses.length
          ? html`<ol class="dose-list">${doses.map(doseRow)}</ol>`
          : html`<p class="muted">No medicines scheduled for today.</p>`}
      </article>

      <article class="panel panel-chart">
        <header class="panel-head"><h3>Adherence, last 7 days</h3><span class="muted small">${adherence.taken} of ${adherence.scheduled} doses</span></header>
        <div class="chart-wrap">${adherenceChart(adherence.byDay)}<div class="chart-tip" role="status" hidden></div></div>
      </article>

      <article class="panel panel-visits">
        <header class="panel-head"><h3>Upcoming visits</h3><a href="#appointments" class="link">All ${icon('arrow', 14)}</a></header>
        ${upcoming.length ? html`<ul class="mini-visits">${upcoming.map((a) => html`
          <li>
            <div class="date-chip"><span>${formatDate(a.date, { month: 'short' })}</span><strong>${formatDate(a.date, { day: 'numeric' })}</strong></div>
            <div class="mini-body"><strong>${a.title}</strong><span class="muted small">${a.doctorName} · ${formatTime(a.time)}</span></div>
            <span class="badge badge-${appointmentStatus(a, now)}">${relativeTime(toDateTime(a.date, a.time), now)}</span>
          </li>`)}</ul>` : html`<p class="muted">No upcoming visits. <button class="link-btn" data-action="open-dialog" data-dialog="apt-dialog">Book one</button></p>`}
      </article>

      <article class="panel panel-ai">
        <header class="panel-head"><h3>Latest visit summary</h3><a href="#summaries" class="link">Open ${icon('arrow', 14)}</a></header>
        ${latest ? html`
          <p class="muted small">${latest.patientName} · ${new Date(latest.createdAt).toLocaleDateString()}</p>
          ${parseSummarySections(latest.summary).slice(0, 2).map((s) => html`<h4 class="sum-h">${s.title}</h4><p class="sum-p">${s.lines.join(' ')}</p>`)}
        ` : html`<p class="muted">Turn a doctor's notes into a plain-language summary. <button class="link-btn" data-action="open-dialog" data-dialog="ai-dialog">Try it</button></p>`}
      </article>
    </section>`;
}
