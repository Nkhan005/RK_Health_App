// Unit tests for pure domain logic. Run with: npm test  (Node >= 18, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appointmentAttendance, appointmentStatus, buildIcs, dosesForDay, escapeHtml, googleCalendarUrl,
  isValidPhone, medicationAdherence, nextAppointment, parseSummarySections, parseTimes, relativeTime,
  toISODate, validateAppointment, validateMedication,
} from '../js/domain.js';
import { summarizeOffline } from '../js/ai-fallback.js';

const NOW = new Date(2026, 10, 8, 12, 0); // 8 Nov 2026, 12:00 local

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escapeHtml(null), '');
});

test('parseTimes understands common free-text formats', () => {
  assert.deepEqual(parseTimes('08:00 & 20:00'), ['08:00', '20:00']);
  assert.deepEqual(parseTimes('8am, 8:30 pm'), ['08:00', '20:30']);
  assert.deepEqual(parseTimes('morning and night'), ['08:00', '21:00']);
  assert.deepEqual(parseTimes(['20:00', '08:00', '08:00']), ['08:00', '20:00']);
  assert.deepEqual(parseTimes('12am'), ['00:00']);
  assert.deepEqual(parseTimes(''), []);
});

test('isValidPhone requires E.164 format', () => {
  assert.ok(isValidPhone('+919876543210'));
  assert.ok(isValidPhone('+1 415-555-0100'));
  assert.ok(!isValidPhone('9876543210'));
  assert.ok(!isValidPhone('+0123'));
});

test('validateAppointment reports missing fields and past times', () => {
  const empty = validateAppointment({}, NOW);
  assert.equal(empty.ok, false);
  assert.deepEqual(Object.keys(empty.errors).sort(), ['date', 'doctorName', 'patientName', 'time', 'title']);
  const past = validateAppointment({ patientName: 'A', doctorName: 'B', title: 'C', date: '2026-11-07', time: '10:00' }, NOW);
  assert.equal(past.errors.date, 'That time has already passed');
  const ok = validateAppointment({ patientName: 'A', doctorName: 'B', title: 'C', date: '2026-11-09', time: '10:00' }, NOW);
  assert.equal(ok.ok, true);
});

test('validateMedication checks times and phone', () => {
  const bad = validateMedication({ medicineName: 'X', dosage: '1', times: [], phoneNumber: '123' });
  assert.ok(bad.errors.times);
  assert.ok(bad.errors.phoneNumber);
  assert.equal(validateMedication({ medicineName: 'X', dosage: '1', times: ['08:00'] }).ok, true);
});

test('appointmentStatus derives upcoming / today / missed / completed', () => {
  assert.equal(appointmentStatus({ date: '2026-11-10', time: '09:00' }, NOW), 'upcoming');
  assert.equal(appointmentStatus({ date: '2026-11-08', time: '15:00' }, NOW), 'today');
  assert.equal(appointmentStatus({ date: '2026-11-08', time: '08:00' }, NOW), 'missed');
  assert.equal(appointmentStatus({ date: '2026-11-01', time: '09:00' }, NOW), 'missed');
  assert.equal(appointmentStatus({ date: '2026-11-01', time: '09:00', status: 'completed' }, NOW), 'completed');
});

test('nextAppointment and attendance', () => {
  const list = [
    { id: 'a', date: '2026-11-12', time: '09:00' },
    { id: 'b', date: '2026-11-09', time: '09:00' },
    { id: 'c', date: '2026-11-01', time: '09:00', status: 'completed' },
    { id: 'd', date: '2026-11-02', time: '09:00' },
  ];
  assert.equal(nextAppointment(list, NOW).id, 'b');
  assert.deepEqual(appointmentAttendance(list, NOW), { completed: 1, missed: 1, pct: 50 });
});

test('dosesForDay flags taken and overdue doses', () => {
  const meds = [{ id: 'm1', medicineName: 'A', times: ['08:00', '20:00'], startDate: '2026-11-01' }];
  const logs = [{ medicationId: 'm1', date: '2026-11-08', time: '08:00' }];
  const doses = dosesForDay(meds, logs, NOW, NOW);
  assert.equal(doses.length, 2);
  assert.deepEqual(doses.map((d) => [d.time, d.taken, d.overdue]), [['08:00', true, true], ['20:00', false, false]]);
});

test('medicationAdherence counts only doses that were due', () => {
  const meds = [{ id: 'm1', times: ['08:00', '20:00'], startDate: '2026-11-07' }];
  const logs = [
    { medicationId: 'm1', date: '2026-11-07', time: '08:00' },
    { medicationId: 'm1', date: '2026-11-07', time: '20:00' },
    { medicationId: 'm1', date: '2026-11-08', time: '08:00' },
  ];
  const result = medicationAdherence(meds, logs, 7, NOW);
  // Due so far: 7th 08:00 + 20:00, 8th 08:00 (20:00 not due yet) => 3 of 3
  assert.equal(result.scheduled, 3);
  assert.equal(result.taken, 3);
  assert.equal(result.pct, 100);
  assert.equal(result.byDay.length, 7);
  assert.equal(result.byDay[0].pct, null); // before start date
});

test('medicationAdherence ignores paused medicines', () => {
  const meds = [{ id: 'm1', times: ['08:00'], startDate: '2026-11-01', active: false }];
  assert.equal(medicationAdherence(meds, [], 7, NOW).pct, null);
});

test('calendar exports contain the right times', () => {
  const apt = { id: 'x1', title: 'Check-up', doctorName: 'Rao', patientName: 'Rahul', date: '2026-11-09', time: '10:30', notes: 'Fasting; bring reports' };
  const url = new URL(googleCalendarUrl(apt));
  assert.equal(url.searchParams.get('dates'), '20261109T103000/20261109T110000');
  assert.match(url.searchParams.get('text'), /Dr\. Rao/);
  const ics = buildIcs(apt);
  assert.match(ics, /DTSTART:20261109T103000/);
  assert.match(ics, /Fasting\\; bring reports/);
  assert.match(ics, /TRIGGER:-PT1H/);
});

test('relativeTime formats both directions', () => {
  assert.equal(relativeTime(new Date(2026, 10, 10, 12, 0), NOW), 'in 2 days');
  assert.equal(relativeTime(new Date(2026, 10, 8, 15, 0), NOW), 'in 3 h');
  assert.equal(relativeTime(new Date(2026, 10, 8, 11, 30), NOW), '30 min ago');
});

test('parseSummarySections splits LLM output into labelled sections', () => {
  const sections = parseSummarySections('**Visit Overview:** Routine check.\nDiagnosis:\n- Mild anaemia\nMedicine Instructions:\n- Iron 1 tab daily\nFollow-up Advice: Review in 4 weeks');
  assert.deepEqual(sections.map((s) => s.title), ['Visit Overview', 'Diagnosis', 'Medicine Instructions', 'Follow-up Advice']);
  assert.deepEqual(sections[1].lines, ['Mild anaemia']);
  assert.deepEqual(sections[3].lines, ['Review in 4 weeks']);
});

test('summarizeOffline produces all four sections', () => {
  const text = summarizeOffline('Patient has fever since 3 days. Diagnosis: viral infection. Paracetamol 500mg thrice daily. Drink plenty of water. Review in 5 days.', 'Asha');
  const titles = parseSummarySections(text).map((s) => s.title);
  assert.deepEqual(titles, ['Visit Overview', 'Diagnosis', 'Medicine Instructions', 'Follow-up Advice']);
  assert.match(text, /Paracetamol 500mg/);
  assert.match(text, /Review in 5 days/);
});

test('toISODate uses local calendar date', () => {
  assert.equal(toISODate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});
