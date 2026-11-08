// Pure domain logic: no DOM, no network. Everything here is unit-tested (tests/domain.test.js).

export const DAY_MS = 86_400_000;
const PHONE_RE = /^\+[1-9]\d{7,14}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Escape a value for safe insertion into HTML. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Short collision-resistant id. */
export function uid(prefix = 'id') {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** Local calendar date as YYYY-MM-DD (not UTC, so "today" matches the user's wall clock). */
export function toISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toHHMM(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Combine a YYYY-MM-DD date and HH:MM time into a local Date. */
export function toDateTime(date, time = '00:00') {
  const [y, m, d] = String(date).split('-').map(Number);
  const [hh, mm] = String(time || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
}

/**
 * Parse free-text dose timings into sorted 24h "HH:MM" slots.
 * Accepts "08:00 & 20:00", "8am, 8pm", "8:30 pm", "morning/night".
 */
export function parseTimes(input) {
  if (Array.isArray(input)) return normalizeTimes(input);
  const text = String(input ?? '').toLowerCase();
  const named = { morning: '08:00', breakfast: '08:00', noon: '13:00', afternoon: '14:00', lunch: '13:00', evening: '19:00', dinner: '20:00', night: '21:00', bedtime: '22:00' };
  const found = [];
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    let hours = Number(match[1]);
    const minutes = Number(match[2] ?? 0);
    const meridiem = match[3];
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    if (hours <= 23 && minutes <= 59) found.push(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
  }
  Object.entries(named).forEach(([word, time]) => {
    if (new RegExp(`\\b${word}\\b`).test(text)) found.push(time);
  });
  return normalizeTimes(found);
}

function normalizeTimes(list) {
  return [...new Set(list.filter((t) => TIME_RE.test(t)))].sort();
}

export function isValidPhone(phone) {
  return PHONE_RE.test(String(phone ?? '').replace(/[\s-]/g, ''));
}

export function normalizePhone(phone) {
  return String(phone ?? '').replace(/[\s-]/g, '');
}

/** @returns {{ok: boolean, errors: Record<string,string>}} */
export function validateAppointment(input, now = new Date()) {
  const errors = {};
  if (!input.patientName?.trim()) errors.patientName = 'Patient name is required';
  if (!input.doctorName?.trim()) errors.doctorName = 'Doctor name is required';
  if (!input.title?.trim()) errors.title = 'Purpose of visit is required';
  if (!input.date) errors.date = 'Pick a date';
  if (!input.time) errors.time = 'Pick a time';
  if (input.date && input.time && !input.allowPast && toDateTime(input.date, input.time) < new Date(now.getTime() - 5 * 60_000)) {
    errors.date = 'That time has already passed';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateMedication(input) {
  const errors = {};
  if (!input.medicineName?.trim()) errors.medicineName = 'Medicine name is required';
  if (!input.dosage?.trim()) errors.dosage = 'Dosage is required';
  if (!parseTimes(input.times ?? input.timing).length) errors.times = 'Add at least one dose time';
  if (input.phoneNumber && !isValidPhone(input.phoneNumber)) errors.phoneNumber = 'Use international format, e.g. +919876543210';
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Derived status: cancelled/completed are stored; today/missed/upcoming are computed from time. */
export function appointmentStatus(apt, now = new Date()) {
  if (apt.status === 'completed' || apt.status === 'cancelled') return apt.status;
  const at = toDateTime(apt.date, apt.time);
  if (toISODate(at) === toISODate(now)) return at.getTime() + 2 * 3_600_000 < now.getTime() ? 'missed' : 'today';
  return at < now ? 'missed' : 'upcoming';
}

export function sortAppointments(list, direction = 'asc') {
  const factor = direction === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => factor * (toDateTime(a.date, a.time) - toDateTime(b.date, b.time)));
}

export function nextAppointment(list, now = new Date()) {
  return sortAppointments(list).find((a) => ['upcoming', 'today'].includes(appointmentStatus(a, now))) ?? null;
}

function medicationActiveOn(med, isoDate) {
  if (med.active === false) return false;
  const start = med.startDate || toISODate(new Date(med.createdAt || Date.now()));
  if (isoDate < start) return false;
  if (med.endDate && isoDate > med.endDate) return false;
  return true;
}

export function doseKey(medicationId, date, time) {
  return `${medicationId}|${date}|${time}`;
}

function takenSet(logs) {
  return new Set(logs.map((l) => doseKey(l.medicationId, l.date, l.time)));
}

/** A day's dose timeline, sorted by time, with taken/overdue flags. */
export function dosesForDay(meds, logs, day = new Date(), now = new Date()) {
  const iso = toISODate(day);
  const taken = takenSet(logs);
  const nowHHMM = toHHMM(now);
  const isToday = iso === toISODate(now);
  return meds
    .filter((m) => medicationActiveOn(m, iso))
    .flatMap((med) => parseTimes(med.times ?? med.timing).map((time) => ({
      medication: med,
      date: iso,
      time,
      taken: taken.has(doseKey(med.id, iso, time)),
      overdue: isToday ? time < nowHHMM : iso < toISODate(now),
    })))
    .sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Medication adherence over the last `days` days, counting only doses whose time has passed (or were taken early).
 * @returns {{scheduled:number, taken:number, pct:number|null, byDay:Array<{date:string,scheduled:number,taken:number,pct:number|null}>}}
 */
export function medicationAdherence(meds, logs, days = 7, now = new Date()) {
  const byDay = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const doses = dosesForDay(meds, logs, day, now).filter((d) => d.overdue || d.taken);
    const taken = doses.filter((d) => d.taken).length;
    byDay.push({ date: toISODate(day), scheduled: doses.length, taken, pct: doses.length ? Math.round((taken / doses.length) * 100) : null });
  }
  const scheduled = byDay.reduce((s, d) => s + d.scheduled, 0);
  const taken = byDay.reduce((s, d) => s + d.taken, 0);
  return { scheduled, taken, pct: scheduled ? Math.round((taken / scheduled) * 100) : null, byDay };
}

/** Appointment attendance: completed vs missed (cancelled excluded). */
export function appointmentAttendance(list, now = new Date()) {
  const statuses = list.map((a) => appointmentStatus(a, now));
  const completed = statuses.filter((s) => s === 'completed').length;
  const missed = statuses.filter((s) => s === 'missed').length;
  const total = completed + missed;
  return { completed, missed, pct: total ? Math.round((completed / total) * 100) : null };
}

const pad = (n) => String(n).padStart(2, '0');
function calStamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function doctorLabel(name) {
  const clean = String(name ?? '').trim();
  return /^dr\.?\s/i.test(clean) ? clean : `Dr. ${clean}`;
}

/** Google Calendar "add event" link (works without any backend). */
export function googleCalendarUrl(apt, durationMin = 30) {
  const start = toDateTime(apt.date, apt.time);
  const end = new Date(start.getTime() + durationMin * 60_000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${apt.title} with ${doctorLabel(apt.doctorName)}`,
    dates: `${calStamp(start)}/${calStamp(end)}`,
    details: `Patient: ${apt.patientName}\n${apt.notes || ''}\n\nCreated with RK Health`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** RFC 5545 .ics file contents with a 1-hour reminder, for Apple/Outlook calendars. */
export function buildIcs(apt, durationMin = 30) {
  const start = toDateTime(apt.date, apt.time);
  const end = new Date(start.getTime() + durationMin * 60_000);
  const esc = (s) => String(s ?? '').replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RK Health//EN', 'BEGIN:VEVENT',
    `UID:${apt.id}@rkhealth`, `DTSTAMP:${calStamp(new Date())}`,
    `DTSTART:${calStamp(start)}`, `DTEND:${calStamp(end)}`,
    `SUMMARY:${esc(apt.title)} - ${esc(doctorLabel(apt.doctorName))}`,
    `DESCRIPTION:${esc(`Patient: ${apt.patientName}\n${apt.notes || ''}`)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Appointment reminder', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

/** Human countdown like "in 2 days", "in 3 h", "in 25 min". */
export function relativeTime(target, now = new Date()) {
  const diff = target.getTime() - now.getTime();
  const abs = Math.abs(diff);
  let value;
  let label;
  if (abs >= DAY_MS) {
    value = Math.round(abs / DAY_MS);
    label = `${value} day${value === 1 ? '' : 's'}`;
  } else if (abs >= 3_600_000) {
    value = Math.round(abs / 3_600_000);
    label = `${value} h`;
  } else {
    value = Math.max(1, Math.round(abs / 60_000));
    label = `${value} min`;
  }
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

/** Parse a backend/LLM summary into labelled sections (Overview, Diagnosis, Medicines, Follow-up). */
export function parseSummarySections(text) {
  const sections = [];
  let current = null;
  String(text ?? '').split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.replace(/\*\*/g, '').trim();
    if (!line) return;
    const heading = line.match(/^#{0,3}\s*(visit overview|overview|diagnosis[^:]*|medicine[^:]*|medication[^:]*|follow[- ]?up[^:]*|advice[^:]*|next steps[^:]*)\s*:\s*(.*)$/i)
      ?? line.match(/^#{1,3}\s*(.+?)\s*:?\s*()$/);
    if (heading) {
      current = { title: heading[1].replace(/\s+/g, ' ').trim(), lines: [] };
      sections.push(current);
      if (heading[2]) current.lines.push(heading[2]);
      return;
    }
    if (!current) {
      current = { title: 'Summary', lines: [] };
      sections.push(current);
    }
    current.lines.push(line.replace(/^[-•*]\s*/, ''));
  });
  return sections;
}
