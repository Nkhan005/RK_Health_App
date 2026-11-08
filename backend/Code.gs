/**
 * RK Health — Google Apps Script backend (v2)
 * ------------------------------------------------------------
 * REST-style action router over Google Sheets, with:
 *  - full CRUD + GET_ALL sync for appointments, medications, dose logs, AI summaries
 *  - scheduled Twilio SMS reminders (time-driven trigger, de-duplicated, skips doses already taken)
 *  - Groq Llama 3.3 70B visit summaries (optional xAI Grok fallback)
 *  - LockService for safe concurrent writes, input validation, simple rate limiting
 *  - secrets ONLY in Script Properties (never in the frontend)
 *
 * Script Properties (Project Settings → Script properties):
 *   GROQ_API_KEY        required for AI summaries
 *   TWILIO_ACCOUNT_SID  required for SMS
 *   TWILIO_AUTH_TOKEN   required for SMS
 *   TWILIO_FROM         your Twilio phone number, e.g. +15005550006
 *   SHEET_ID            optional: spreadsheet id if the script is not bound to a sheet
 *   XAI_API_KEY         optional: fallback to xAI Grok when Groq fails
 *   XAI_MODEL           optional: defaults to "grok-3-mini"
 *
 * First-time setup: run `setup()` once from the editor (creates tabs + the 15-minute reminder trigger),
 * then Deploy → New deployment → Web app (Execute as: Me, Access: Anyone).
 */

const API_VERSION = '2.0.0';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const REMINDER_WINDOW_MIN = 15;
const MAX_TEXT = 4000;

const SHEETS = {
  appointments: { name: 'Appointments', headers: ['id', 'patientName', 'doctorName', 'date', 'time', 'title', 'notes', 'status', 'calendarUrl', 'createdAt', 'updatedAt'] },
  medications: { name: 'Medications', headers: ['id', 'medicineName', 'dosage', 'times', 'phoneNumber', 'active', 'startDate', 'createdAt', 'updatedAt'] },
  doseLogs: { name: 'DoseLogs', headers: ['id', 'medicationId', 'date', 'time', 'takenAt'] },
  summaries: { name: 'Summaries', headers: ['id', 'patientName', 'appointmentId', 'rawNotes', 'summary', 'model', 'createdAt'] },
  smsLog: { name: 'SmsLog', headers: ['id', 'medicationId', 'date', 'time', 'to', 'status', 'sentAt', 'error'] },
};

// =============================================================================================
// HTTP entry points
// =============================================================================================
function doGet() {
  return json({ status: 'success', service: 'RK Health API', version: API_VERSION, time: new Date().toISOString() });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const handler = ROUTES[body.action];
    if (!handler) return json({ status: 'error', message: 'Unknown action: ' + body.action });
    return json(Object.assign({ status: 'success' }, handler(body.payload || {})));
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json({ status: 'error', message: (err && err.message) || 'Unexpected server error' });
  }
}

const ROUTES = {
  PING: () => ({ version: API_VERSION }),
  GET_ALL: getAll,
  ADD_APPOINTMENT: addAppointment,
  UPDATE_APPOINTMENT: (p) => withLock(() => updateRecord('appointments', requireId(p), pick(p, ['status', 'notes', 'date', 'time', 'title']))),
  DELETE_APPOINTMENT: (p) => withLock(() => deleteRecord('appointments', requireId(p))),
  ADD_MEDICATION: addMedication,
  UPDATE_MEDICATION: (p) => withLock(() => updateRecord('medications', requireId(p), pick(p, ['active', 'dosage', 'phoneNumber']))),
  DELETE_MEDICATION: deleteMedication,
  LOG_DOSE: logDose,
  DELETE_DOSE: (p) => withLock(() => deleteRecord('doseLogs', requireId(p))),
  SEND_SMS: sendSmsNow,
  GENERATE_SUMMARY: generateSummary,
  DELETE_SUMMARY: (p) => withLock(() => deleteRecord('summaries', requireId(p))),
};

// =============================================================================================
// Actions
// =============================================================================================
function getAll() {
  return {
    data: {
      appointments: readAll('appointments'),
      medications: readAll('medications').map((m) => Object.assign({}, m, {
        times: String(m.times || '').split(',').map((t) => t.trim()).filter(Boolean),
        active: String(m.active) !== 'false',
      })),
      doseLogs: readAll('doseLogs'),
      summaries: readAll('summaries'),
    },
  };
}

function addAppointment(p) {
  const record = {
    id: p.id || Utilities.getUuid(),
    patientName: requireText(p.patientName, 'patientName', 120),
    doctorName: requireText(p.doctorName, 'doctorName', 120),
    date: requireMatch(p.date, /^\d{4}-\d{2}-\d{2}$/, 'date'),
    time: requireMatch(p.time, /^\d{2}:\d{2}$/, 'time'),
    title: requireText(p.title, 'title', 200),
    notes: optionalText(p.notes, 1000),
    status: p.status === 'completed' ? 'completed' : 'scheduled',
    createdAt: p.createdAt || new Date().toISOString(),
  };
  record.calendarUrl = calendarUrl(record);
  withLock(() => upsertRecord('appointments', record));
  return { id: record.id, calendarUrl: record.calendarUrl };
}

function addMedication(p) {
  const times = (Array.isArray(p.times) ? p.times : String(p.timing || '').split(/[,&]/))
    .map((t) => String(t).trim()).filter((t) => /^\d{2}:\d{2}$/.test(t));
  if (!times.length) throw new Error('At least one dose time (HH:MM) is required');
  const phone = optionalText(p.phoneNumber, 20).replace(/[\s-]/g, '');
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Phone must be in international format, e.g. +919876543210');
  const record = {
    id: p.id || Utilities.getUuid(),
    medicineName: requireText(p.medicineName, 'medicineName', 120),
    dosage: requireText(p.dosage, 'dosage', 200),
    times: times.join(','),
    phoneNumber: phone,
    active: p.active === false ? 'false' : 'true',
    startDate: p.startDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    createdAt: p.createdAt || new Date().toISOString(),
  };
  withLock(() => upsertRecord('medications', record));
  return { id: record.id };
}

function deleteMedication(p) {
  const id = requireId(p);
  withLock(() => {
    deleteRecord('medications', id);
    deleteWhere('doseLogs', (row) => row.medicationId === id);
  });
  return {};
}

function logDose(p) {
  const record = {
    id: p.id || Utilities.getUuid(),
    medicationId: requireText(p.medicationId, 'medicationId', 80),
    date: requireMatch(p.date, /^\d{4}-\d{2}-\d{2}$/, 'date'),
    time: requireMatch(p.time, /^\d{2}:\d{2}$/, 'time'),
    takenAt: p.takenAt || new Date().toISOString(),
  };
  withLock(() => upsertRecord('doseLogs', record));
  return { id: record.id };
}

function sendSmsNow(p) {
  rateLimit('sms', 10);
  const med = p.medicationId ? findById('medications', p.medicationId) : null;
  const to = String((med && med.phoneNumber) || p.phoneNumber || '').replace(/[\s-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(to)) throw new Error('No valid phone number for this medicine');
  const name = (med && med.medicineName) || p.medicineName || 'your medicine';
  const dosage = (med && med.dosage) || p.dosage || '';
  return { sid: sendTwilioSms(to, reminderText(name, dosage)) };
}

function generateSummary(p) {
  rateLimit('ai', 15);
  const rawNotes = requireText(p.rawNotes, 'rawNotes', MAX_TEXT);
  const result = summarizeWithLlm(rawNotes);
  const record = {
    id: p.id || Utilities.getUuid(),
    patientName: optionalText(p.patientName, 120) || 'Patient',
    appointmentId: optionalText(p.appointmentId, 80),
    rawNotes: rawNotes,
    summary: result.text,
    model: result.model,
    createdAt: p.createdAt || new Date().toISOString(),
  };
  withLock(() => upsertRecord('summaries', record));
  return { id: record.id, summary: record.summary, model: record.model };
}

// =============================================================================================
// Scheduled reminders (time-driven trigger every 15 minutes)
// =============================================================================================
function sendDueReminders() {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const nowMin = toMinutes(Utilities.formatDate(now, tz, 'HH:mm'));
  const taken = new Set(readAll('doseLogs').map((l) => [l.medicationId, l.date, l.time].join('|')));
  const sent = new Set(readAll('smsLog').filter((s) => s.date === today && s.status === 'sent').map((s) => [s.medicationId, s.time].join('|')));

  readAll('medications')
    .filter((m) => String(m.active) !== 'false' && m.phoneNumber && (!m.startDate || m.startDate <= today))
    .forEach((med) => {
      String(med.times || '').split(',').map((t) => t.trim()).filter(Boolean).forEach((time) => {
        const diff = nowMin - toMinutes(time);
        if (diff < 0 || diff >= REMINDER_WINDOW_MIN) return;
        if (taken.has([med.id, today, time].join('|')) || sent.has([med.id, time].join('|'))) return;
        const log = { id: Utilities.getUuid(), medicationId: med.id, date: today, time: time, to: med.phoneNumber, sentAt: new Date().toISOString() };
        try {
          sendTwilioSms(med.phoneNumber, reminderText(med.medicineName, med.dosage, time));
          upsertRecord('smsLog', Object.assign(log, { status: 'sent', error: '' }));
        } catch (err) {
          upsertRecord('smsLog', Object.assign(log, { status: 'failed', error: String(err.message || err).slice(0, 300) }));
        }
      });
    });
}

/** Run once from the editor: creates all tabs (plain-text cells) and installs the reminder trigger. Safe to re-run. */
function setup() {
  Object.keys(SHEETS).forEach((key) => getSheet(key).getRange('A:Z').setNumberFormat('@'));
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'sendDueReminders')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendDueReminders').timeBased().everyMinutes(15).create();
  console.log('RK Health backend ready: tabs created and reminder trigger installed.');
}

// =============================================================================================
// Integrations
// =============================================================================================
function reminderText(name, dosage, time) {
  return 'RK Health reminder: time to take ' + name + (dosage ? ' (' + dosage + ')' : '') + (time ? ' at ' + time : '') + '.';
}

function sendTwilioSms(to, body) {
  const props = PropertiesService.getScriptProperties();
  const sid = props.getProperty('TWILIO_ACCOUNT_SID');
  const token = props.getProperty('TWILIO_AUTH_TOKEN');
  const from = props.getProperty('TWILIO_FROM');
  if (!sid || !token || !from) throw new Error('Twilio is not configured on the server');
  const res = UrlFetchApp.fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
    method: 'post',
    payload: { To: to, From: from, Body: body },
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + token) },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300) throw new Error('Twilio: ' + (data.message || res.getResponseCode()));
  return data.sid;
}

const SUMMARY_PROMPT = [
  'You are a medical scribe who explains doctor notes to patients in simple, friendly language (reading age 12).',
  'Return EXACTLY these four sections, each heading on its own line followed by 1-4 short bullet points starting with "- ":',
  'Visit Overview:', 'Diagnosis:', 'Medicine Instructions:', 'Follow-up Advice:',
  'Expand abbreviations (BD = twice a day, OD = once a day, TDS = three times a day, c/o = complains of).',
  'Never invent medicines, doses or diagnoses that are not in the notes. If something is missing, write "Not mentioned in the notes".',
  'Do not add any other text before or after the sections.',
].join('\n');

function summarizeWithLlm(notes) {
  const props = PropertiesService.getScriptProperties();
  const groqKey = props.getProperty('GROQ_API_KEY');
  const xaiKey = props.getProperty('XAI_API_KEY');
  let lastError = null;
  if (groqKey) {
    try {
      return { text: chatCompletion('https://api.groq.com/openai/v1/chat/completions', groqKey, GROQ_MODEL, notes), model: GROQ_MODEL };
    } catch (err) {
      lastError = err;
    }
  }
  if (xaiKey) {
    const model = props.getProperty('XAI_MODEL') || 'grok-3-mini';
    return { text: chatCompletion('https://api.x.ai/v1/chat/completions', xaiKey, model, notes), model: model };
  }
  throw lastError || new Error('AI is not configured on the server (missing GROQ_API_KEY)');
}

function chatCompletion(url, key, model, notes) {
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify({
      model: model,
      temperature: 0.2,
      max_tokens: 600,
      messages: [{ role: 'system', content: SUMMARY_PROMPT }, { role: 'user', content: 'Doctor notes:\n' + notes }],
    }),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300) throw new Error('AI provider error: ' + ((data.error && data.error.message) || res.getResponseCode()));
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('AI provider returned an empty summary');
  return text.trim();
}

function calendarUrl(apt) {
  const tz = Session.getScriptTimeZone();
  const start = Utilities.parseDate(apt.date + ' ' + apt.time, tz, 'yyyy-MM-dd HH:mm');
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const fmt = (d) => Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  const doctor = /^dr\.?\s/i.test(apt.doctorName) ? apt.doctorName : 'Dr. ' + apt.doctorName;
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + '&text=' + encodeURIComponent(apt.title + ' with ' + doctor)
    + '&dates=' + fmt(start) + '/' + fmt(end)
    + '&details=' + encodeURIComponent('Patient: ' + apt.patientName + '\n' + (apt.notes || '') + '\n\nCreated with RK Health');
}

// =============================================================================================
// Sheets repository
// =============================================================================================
function spreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/** Returns the tab, creating it (or adding missing header columns) as needed. */
function getSheet(key) {
  const def = SHEETS[key];
  const ss = spreadsheet();
  let sheet = ss.getSheetByName(def.name);
  if (!sheet) {
    sheet = ss.insertSheet(def.name);
    sheet.getRange('A:Z').setNumberFormat('@'); // keep dates/times/phones as text, no auto-conversion
    sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }
  const current = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].map(String);
  const missing = def.headers.filter((h) => current.indexOf(h) === -1);
  if (missing.length) {
    sheet.getRange(1, current.filter(Boolean).length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
  return sheet;
}

function headersOf(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}

function readAll(key) {
  const sheet = getSheet(key);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const headers = headersOf(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();
  const idCol = headers.indexOf('id');
  return values
    .map((row, i) => {
      if (idCol >= 0 && !row[idCol] && row.some(Boolean)) { // legacy v1 rows without ids get one
        row[idCol] = Utilities.getUuid();
        sheet.getRange(i + 2, idCol + 1).setValue(row[idCol]);
      }
      return headers.reduce((obj, h, c) => { if (h) obj[h] = row[c]; return obj; }, {});
    })
    .filter((obj) => obj.id);
}

function findRowIndex(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const idCol = headersOf(sheet).indexOf('id') + 1;
  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getDisplayValues().map((r) => r[0]);
  const i = ids.indexOf(String(id));
  return i === -1 ? -1 : i + 2;
}

function findById(key, id) {
  return readAll(key).filter((r) => r.id === id)[0] || null;
}

function upsertRecord(key, record) {
  const sheet = getSheet(key);
  const headers = headersOf(sheet);
  const row = findRowIndex(sheet, record.id);
  const stamped = Object.assign({}, record, headers.indexOf('updatedAt') >= 0 ? { updatedAt: new Date().toISOString() } : {});
  if (row === -1) {
    sheet.appendRow(headers.map((h) => (stamped[h] === undefined ? '' : String(stamped[h]))));
    return;
  }
  const existing = sheet.getRange(row, 1, 1, headers.length).getDisplayValues()[0];
  sheet.getRange(row, 1, 1, headers.length).setValues([headers.map((h, c) => (stamped[h] === undefined ? existing[c] : String(stamped[h])))]);
}

function updateRecord(key, id, patch) {
  const sheet = getSheet(key);
  if (findRowIndex(sheet, id) === -1) throw new Error('Record not found: ' + id);
  upsertRecord(key, Object.assign({ id: id }, patch));
  return {};
}

function deleteRecord(key, id) {
  const sheet = getSheet(key);
  const row = findRowIndex(sheet, id);
  if (row !== -1) sheet.deleteRow(row);
  return {};
}

function deleteWhere(key, predicate) {
  const sheet = getSheet(key);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const headers = headersOf(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();
  for (let i = values.length - 1; i >= 0; i -= 1) { // bottom-up so row indexes stay valid
    const obj = headers.reduce((o, h, c) => { o[h] = values[i][c]; return o; }, {});
    if (predicate(obj)) sheet.deleteRow(i + 2);
  }
}

// =============================================================================================
// Helpers: validation, locking, rate limiting, JSON
// =============================================================================================
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn() || {};
  } finally {
    lock.releaseLock();
  }
}

function rateLimit(bucket, maxPerMinute) {
  const cache = CacheService.getScriptCache();
  const key = 'rl_' + bucket + '_' + Math.floor(Date.now() / 60000);
  const count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), 120);
  if (count > maxPerMinute) throw new Error('Too many requests, please wait a minute');
}

function requireId(p) {
  return requireText(p.id, 'id', 80);
}

function requireText(value, field, max) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) throw new Error(field + ' is required');
  if (text.length > max) throw new Error(field + ' is too long');
  return text;
}

function optionalText(value, max) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

function requireMatch(value, re, field) {
  const text = String(value || '').trim();
  if (!re.test(text)) throw new Error(field + ' has an invalid format');
  return text;
}

function pick(obj, keys) {
  return keys.reduce((out, k) => {
    if (obj[k] !== undefined) out[k] = typeof obj[k] === 'boolean' ? String(obj[k]) : optionalText(obj[k], 1000);
    return out;
  }, {});
}

function toMinutes(hhmm) {
  const parts = String(hhmm).split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
