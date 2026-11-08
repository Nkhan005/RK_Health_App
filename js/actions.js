// User actions (create / update / delete) for every feature. Each action:
// 1) validates input, 2) updates local state immediately (optimistic UI),
// 3) queues the cloud write via the outbox, 4) gives feedback (toast, often with Undo).
import { apiCall } from './api.js';
import { LIMITS } from './config.js';
import { summarizeOffline } from './ai-fallback.js';
import {
  buildIcs, doseKey, googleCalendarUrl, normalizePhone, parseTimes, toISODate, uid,
  validateAppointment, validateMedication,
} from './domain.js';
import { enqueue } from './sync.js';
import { findById, getState, removeById, update, upsert } from './store.js';
import { closeDialog, downloadFile, openDialog, readForm, setBusy, showErrors, toast } from './ui.js';

/** Demo records never touch the cloud. */
function cloud(record, action, payload) {
  if (!record?.demo) enqueue(action, payload);
}

function withUndo(message, undo) {
  toast(message, { type: 'info', action: { label: 'Undo', run: undo } });
}

// ---- Appointments -----------------------------------------------------------------------
export function submitAppointment(form) {
  const input = readForm(form);
  const { ok, errors } = validateAppointment(input);
  if (!ok) {
    showErrors(form, errors);
    return;
  }
  const base = {
    id: uid('apt'),
    patientName: input.patientName,
    doctorName: input.doctorName,
    date: input.date,
    time: input.time,
    title: input.title,
    notes: input.notes || '',
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    synced: false,
  };
  const record = { ...base, calendarUrl: googleCalendarUrl(base) };
  upsert('appointments', record);
  cloud(record, 'ADD_APPOINTMENT', record);
  form.reset();
  closeDialog('apt-dialog');
  toast('Appointment saved', {
    type: 'success',
    action: { label: 'Add to Google Calendar', run: () => window.open(record.calendarUrl, '_blank', 'noopener') },
  });
}

export function completeAppointment(id) {
  const apt = findById('appointments', id);
  if (!apt) return;
  upsert('appointments', { id, status: 'completed' });
  cloud(apt, 'UPDATE_APPOINTMENT', { id, status: 'completed' });
  toast('Marked as attended', { type: 'success', action: { label: 'Summarize visit', run: () => openSummaryFor(id) } });
}

export function deleteAppointment(id) {
  const apt = findById('appointments', id);
  if (!apt) return;
  removeById('appointments', id);
  cloud(apt, 'DELETE_APPOINTMENT', { id });
  withUndo(`Deleted "${apt.title}"`, () => {
    upsert('appointments', { ...apt, synced: false });
    cloud(apt, 'ADD_APPOINTMENT', apt);
  });
}

export function downloadIcs(id) {
  const apt = findById('appointments', id);
  if (!apt) return;
  downloadFile(`${apt.title.replace(/[^\w-]+/g, '_')}_${apt.date}.ics`, buildIcs(apt), 'text/calendar');
  toast('Calendar file downloaded. Open it to add the visit with a 1-hour reminder', { type: 'success' });
}

export function openSummaryFor(id) {
  const apt = findById('appointments', id);
  const dialog = openDialog('ai-dialog');
  if (!apt || !dialog) return;
  const form = dialog.querySelector('form');
  form.elements.patientName.value = apt.patientName;
  form.elements.appointmentId.value = apt.id;
  form.elements.rawNotes.value = apt.notes ? `${apt.title}. ${apt.notes}. ` : `${apt.title}. `;
  form.elements.rawNotes.focus();
}

// ---- Medications ------------------------------------------------------------------------
export function submitMedication(form, times) {
  const input = { ...readForm(form), times };
  const { ok, errors } = validateMedication(input);
  if (!ok) {
    showErrors(form, errors);
    return false;
  }
  const sortedTimes = parseTimes(times);
  const now = new Date();
  const record = {
    id: uid('med'),
    medicineName: input.medicineName,
    dosage: input.dosage,
    times: sortedTimes,
    timing: sortedTimes.join(', '), // v1 backend compatibility
    phoneNumber: input.phoneNumber ? normalizePhone(input.phoneNumber) : '',
    smsEnabled: Boolean(input.phoneNumber),
    active: true,
    startDate: toISODate(now),
    createdAt: now.toISOString(),
    synced: false,
  };
  upsert('medications', record);
  cloud(record, 'ADD_MEDICATION', record);
  form.reset();
  closeDialog('med-dialog');
  toast(`${record.medicineName} added${record.phoneNumber ? ', SMS reminders on' : ''}`, { type: 'success' });
  return true;
}

export function toggleDose({ id, date, time }) {
  const med = findById('medications', id);
  if (!med) return;
  const existing = getState().doseLogs.find((l) => doseKey(l.medicationId, l.date, l.time) === doseKey(id, date, time));
  if (existing) {
    removeById('doseLogs', existing.id);
    cloud(med, 'DELETE_DOSE', { id: existing.id });
    return;
  }
  const log = { id: uid('dose'), medicationId: id, date, time, takenAt: new Date().toISOString(), synced: false, ...(med.demo ? { demo: true } : {}) };
  upsert('doseLogs', log);
  cloud(med, 'LOG_DOSE', log);
  toast(`${med.medicineName} marked as taken`, { type: 'success', duration: 2200 });
}

export function toggleMedicationActive(id) {
  const med = findById('medications', id);
  if (!med) return;
  const active = med.active === false;
  upsert('medications', { id, active });
  cloud(med, 'UPDATE_MEDICATION', { id, active });
  toast(active ? `${med.medicineName} resumed` : `${med.medicineName} paused, no reminders will be sent`);
}

export function deleteMedication(id) {
  const med = findById('medications', id);
  if (!med) return;
  const logs = getState().doseLogs.filter((l) => l.medicationId === id);
  update((s) => ({ medications: s.medications.filter((m) => m.id !== id), doseLogs: s.doseLogs.filter((l) => l.medicationId !== id) }));
  cloud(med, 'DELETE_MEDICATION', { id });
  withUndo(`Deleted ${med.medicineName}`, () => {
    update((s) => ({ medications: [{ ...med, synced: false }, ...s.medications], doseLogs: [...logs, ...s.doseLogs] }));
    cloud(med, 'ADD_MEDICATION', med);
    logs.forEach((l) => cloud(med, 'LOG_DOSE', l));
  });
}

export async function sendSmsNow(id, button) {
  const med = findById('medications', id);
  if (!med) return;
  setBusy(button, true, 'Sending…');
  try {
    await apiCall('SEND_SMS', { medicationId: id, phoneNumber: med.phoneNumber, medicineName: med.medicineName, dosage: med.dosage });
    toast(`Reminder SMS sent to ${med.phoneNumber}`, { type: 'success' });
  } catch (error) {
    const hint = error.kind === 'config' ? 'connect the cloud backend in Settings to send SMS' : error.message;
    toast(`SMS not sent: ${hint}`, { type: 'error' });
  } finally {
    setBusy(button, false);
  }
}

// ---- AI summaries -----------------------------------------------------------------------
export async function submitSummary(form) {
  const input = readForm(form);
  if (!input.rawNotes || input.rawNotes.length < 15) {
    showErrors(form, { rawNotes: 'Paste at least a sentence of the doctor’s notes' });
    return;
  }
  const button = form.querySelector('[type=submit]');
  const patientName = input.patientName || 'Patient';
  const base = { id: uid('sum'), patientName, rawNotes: input.rawNotes, appointmentId: input.appointmentId || '', createdAt: new Date().toISOString() };
  setBusy(button, true, 'Summarizing with Llama 3.3…');
  form.classList.add('is-loading');
  let record;
  try {
    const result = await apiCall('GENERATE_SUMMARY', base, { timeoutMs: LIMITS.aiTimeoutMs });
    record = { ...base, summary: result.summary, model: result.model || 'llama-3.3-70b-versatile', synced: true };
    toast('AI summary ready', { type: 'success' });
  } catch (error) {
    record = { ...base, summary: summarizeOffline(input.rawNotes, patientName), model: 'offline-draft', synced: false };
    toast(`AI service unavailable (${error.message}). Created an offline draft instead.`, { type: 'error', duration: 6000 });
  } finally {
    setBusy(button, false);
    form.classList.remove('is-loading');
  }
  upsert('summaries', record);
  form.reset();
  closeDialog('ai-dialog');
  window.location.hash = '#summaries';
}

export function deleteSummary(id) {
  const summary = findById('summaries', id);
  if (!summary) return;
  removeById('summaries', id);
  if (summary.synced) cloud(summary, 'DELETE_SUMMARY', { id });
  withUndo('Summary deleted', () => upsert('summaries', { ...summary, synced: false }));
}

export async function copySummary(id) {
  const summary = findById('summaries', id);
  if (!summary) return;
  try {
    await navigator.clipboard.writeText(`Visit summary for ${summary.patientName}\n\n${summary.summary}`);
    toast('Summary copied to clipboard', { type: 'success' });
  } catch {
    toast('Clipboard is blocked in this browser', { type: 'error' });
  }
}
