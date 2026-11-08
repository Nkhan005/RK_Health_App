// Printable health report built from state (not scraped from the DOM), plus CSV export.
import {
  appointmentAttendance, appointmentStatus, medicationAdherence, parseSummarySections,
  parseTimes, sortAppointments,
} from '../domain.js';
import { formatDate, formatTime, html, icon, raw } from '../ui.js';

export function patientsOf(state) {
  return [...new Set([...state.appointments, ...state.summaries].map((x) => x.patientName).filter(Boolean))].sort();
}

/** Restrict appointments/summaries to one patient; medicines belong to the device profile. */
export function reportData(state, patient) {
  const byPatient = (x) => !patient || x.patientName === patient;
  return {
    appointments: sortAppointments(state.appointments.filter(byPatient), 'desc'),
    summaries: state.summaries.filter(byPatient),
    medications: state.medications,
    doseLogs: state.doseLogs,
  };
}

export function reportCsv(state, patient, now = new Date()) {
  const data = reportData(state, patient);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Type', 'Date', 'Time', 'Title/Medicine', 'Doctor/Dosage', 'Patient', 'Status/Adherence', 'Notes']];
  data.appointments.forEach((a) => rows.push(['Appointment', a.date, a.time, a.title, a.doctorName, a.patientName, appointmentStatus(a, now), a.notes]));
  data.medications.forEach((m) => {
    const adh = medicationAdherence([m], data.doseLogs, 30, now).pct;
    rows.push(['Medication', m.startDate || '', parseTimes(m.times ?? m.timing).join(' '), m.medicineName, m.dosage, '', adh === null ? 'n/a' : `${adh}% (30d)`, m.phoneNumber ? `SMS ${m.phoneNumber}` : '']);
  });
  data.summaries.forEach((s) => rows.push(['AI Summary', String(s.createdAt).slice(0, 10), '', 'Visit summary', s.model, s.patientName, '', s.summary]));
  return rows.map((r) => r.map(q).join(',')).join('\r\n');
}

function meter(pct) {
  if (pct === null) return '—';
  return html`<span class="meter" aria-hidden="true"><span style="width:${raw(String(Math.max(0, Math.min(100, pct))))}%"></span></span> ${pct}%`;
}

export function renderReport(state, { now, filters }) {
  const patients = patientsOf(state);
  const patient = filters.report?.patient && patients.includes(filters.report.patient) ? filters.report.patient : '';
  const data = reportData(state, patient);
  const adherence30 = medicationAdherence(data.medications, data.doseLogs, 30, now);
  const attendance = appointmentAttendance(data.appointments, now);
  const isEmpty = !data.appointments.length && !data.medications.length && !data.summaries.length;

  return html`
    <div class="toolbar no-print">
      ${patients.length > 1 ? html`<label class="select-wrap">${icon('user', 16)}
        <select data-filter="report.patient" aria-label="Report for patient">
          <option value="">All patients</option>
          ${patients.map((p) => html`<option value="${p}" ${p === patient ? 'selected' : ''}>${p}</option>`)}
        </select></label>` : ''}
      <div class="toolbar-actions">
        <button class="btn btn-ghost" data-action="export-csv">${icon('download')} CSV</button>
        <button class="btn btn-primary" data-action="print">${icon('printer')} Print / Save PDF</button>
      </div>
    </div>

    <article class="report-doc">
      <header class="report-head">
        <div class="report-brand">${icon('heart', 22)} <span>RK Health</span></div>
        <div class="report-title">
          <h2>Personal Health Report</h2>
          <p>${patient || 'All patients'} · Generated ${now.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}</p>
        </div>
      </header>

      ${isEmpty ? html`<p class="muted">No records yet. Add appointments, medicines or AI summaries to build your report.</p>` : html`
      <section class="report-stats">
        <div><span>${data.appointments.length}</span>Appointments</div>
        <div><span>${attendance.pct === null ? '—' : `${attendance.pct}%`}</span>Visit attendance</div>
        <div><span>${data.medications.filter((m) => m.active !== false).length}</span>Active medicines</div>
        <div><span>${adherence30.pct === null ? '—' : `${adherence30.pct}%`}</span>30-day adherence</div>
      </section>

      <section class="report-sec">
        <h3>Medicines</h3>
        ${data.medications.length ? html`<div class="table-scroll"><table class="table">
          <thead><tr><th>Medicine</th><th>Dosage</th><th>Times</th><th>30-day adherence</th><th>Status</th></tr></thead>
          <tbody>${data.medications.map((m) => html`<tr><td>${m.medicineName}</td><td>${m.dosage}</td><td>${parseTimes(m.times ?? m.timing).map(formatTime).join(', ')}</td>
              <td class="nowrap">${meter(medicationAdherence([m], data.doseLogs, 30, now).pct)}</td><td>${m.active === false ? 'Paused' : 'Active'}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">None recorded.</p>`}
      </section>

      <section class="report-sec">
        <h3>Appointments</h3>
        ${data.appointments.length ? html`<div class="table-scroll"><table class="table">
          <thead><tr><th>Date</th><th>Reason</th><th>Doctor</th><th>Patient</th><th>Status</th></tr></thead>
          <tbody>${data.appointments.map((a) => {
            const status = appointmentStatus(a, now);
            return html`<tr><td class="nowrap">${formatDate(a.date, { day: 'numeric', month: 'short', year: 'numeric' })}, ${formatTime(a.time)}</td><td>${a.title}</td><td>${a.doctorName}</td><td>${a.patientName}</td><td><span class="badge badge-${status}">${status === 'completed' ? 'attended' : status}</span></td></tr>`;
          })}</tbody>
        </table></div>` : html`<p class="muted">None recorded.</p>`}
      </section>

      <section class="report-sec">
        <h3>Visit summaries</h3>
        ${data.summaries.length ? data.summaries.map((s) => html`
          <div class="report-sum">
            <p class="muted small">${s.patientName} · ${new Date(s.createdAt).toLocaleDateString()}</p>
            ${parseSummarySections(s.summary).map((sec) => html`<p><strong>${sec.title}:</strong> ${sec.lines.join(' ')}</p>`)}
          </div>`) : html`<p class="muted">None recorded.</p>`}
      </section>`}

      <footer class="report-foot">Generated from patient-entered data for personal records and for sharing with a doctor. Not a medical document.</footer>
    </article>`;
}
