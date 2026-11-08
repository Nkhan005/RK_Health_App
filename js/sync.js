// Offline-first sync engine.
// Writes are applied to local state immediately (optimistic UI), then queued in an
// "outbox" that is flushed to Google Sheets in order. Network failures keep the op
// queued for retry; server rejections drop it and surface an error.
import { apiCall } from './api.js';
import { getSettings, getState, update } from './store.js';
import { parseTimes, toHHMM, toISODate, uid } from './domain.js';

const COLLECTIONS = ['appointments', 'medications', 'doseLogs', 'summaries'];
const statusListeners = new Set();
let status = { state: 'idle', detail: '', pending: 0 };
let flushing = false;
let onRejected = () => {};

/** @typedef {'idle'|'online'|'syncing'|'offline'|'local'|'limited'} SyncState */

export function onStatusChange(fn) {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}

export function onOpRejected(fn) {
  onRejected = fn;
}

function setStatus(state, detail = '') {
  status = { state, detail, pending: getState().outbox.length };
  statusListeners.forEach((fn) => fn(status));
}

export function getStatus() {
  return status;
}

/** Queue a backend write and try to flush right away. */
export function enqueue(action, payload) {
  update((s) => ({ outbox: [...s.outbox, { id: uid('op'), action, payload, queuedAt: new Date().toISOString() }] }));
  return flush();
}

function removeOp(opId) {
  update((s) => ({ outbox: s.outbox.filter((o) => o.id !== opId) }));
}

const COLLECTION_BY_ACTION = {
  ADD_APPOINTMENT: 'appointments',
  UPDATE_APPOINTMENT: 'appointments',
  ADD_MEDICATION: 'medications',
  UPDATE_MEDICATION: 'medications',
  LOG_DOSE: 'doseLogs',
};

function markSynced(op, result) {
  const collection = COLLECTION_BY_ACTION[op.action];
  if (!collection || !op.payload?.id) return;
  update((s) => ({
    [collection]: s[collection].map((item) => (item.id === op.payload.id
      ? { ...item, synced: true, ...(result.calendarUrl ? { calendarUrl: result.calendarUrl } : {}) }
      : item)),
  }));
}

export async function flush() {
  if (flushing) return;
  if (!getSettings().apiUrl) {
    setStatus('local', 'Data stays on this device');
    return;
  }
  flushing = true;
  setStatus('syncing');
  try {
    for (const op of getState().outbox) {
      try {
        const result = await apiCall(op.action, op.payload);
        markSynced(op, result);
        removeOp(op.id);
      } catch (error) {
        if (error.kind === 'network') {
          setStatus('offline', 'Changes saved locally, will sync when online');
          return;
        }
        removeOp(op.id);
        onRejected(op, error);
      }
    }
    setStatus('online', 'All changes saved to Google Sheets');
  } finally {
    flushing = false;
  }
}

// ---- Pull: Google Sheets -> local cache -------------------------------------------------

/** Sheets may hand back Date-typed cells as ISO timestamps; normalise to our formats. */
function normaliseDate(value) {
  if (!value) return '';
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : toISODate(new Date(text));
}

function normaliseTime(value) {
  if (!value) return '';
  const text = String(value);
  return /^\d{2}:\d{2}$/.test(text) ? text : toHHMM(new Date(text));
}

const NORMALISERS = {
  appointments: (a) => ({ ...a, date: normaliseDate(a.date), time: normaliseTime(a.time), status: a.status || 'scheduled' }),
  medications: (m) => ({ ...m, times: parseTimes(m.times || m.timing), active: m.active !== false && m.active !== 'FALSE', smsEnabled: Boolean(m.phoneNumber) }),
  doseLogs: (l) => ({ ...l, date: normaliseDate(l.date), time: normaliseTime(l.time) }),
  summaries: (s) => s,
};

function mergeCollection(name, serverItems, local, pendingDeletes) {
  const fromServer = (serverItems || [])
    .filter((item) => item && item.id && !pendingDeletes.has(item.id))
    .map((item) => ({ ...NORMALISERS[name](item), synced: true }));
  const serverIds = new Set(fromServer.map((i) => i.id));
  const unsyncedLocal = local.filter((item) => (item.demo || !item.synced) && !serverIds.has(item.id));
  return [...unsyncedLocal, ...fromServer];
}

/** Fetch every record from Sheets and merge with unsynced local changes. */
export async function pullAll() {
  if (!getSettings().apiUrl) {
    setStatus('local', 'Data stays on this device');
    return false;
  }
  setStatus('syncing');
  try {
    const result = await apiCall('GET_ALL');
    const data = result.data || {};
    const pendingDeletes = new Set(getState().outbox.filter((o) => o.action.startsWith('DELETE_')).map((o) => o.payload.id));
    update((s) => Object.fromEntries([
      ...COLLECTIONS.map((name) => [name, mergeCollection(name, data[name], s[name], pendingDeletes)]),
      ['lastSyncAt', new Date().toISOString()],
    ]));
    setStatus('online', 'Synced with Google Sheets');
    await flush();
    return true;
  } catch (error) {
    if (error.kind === 'server') setStatus('limited', 'Backend does not support full sync yet, using local cache');
    else setStatus('offline', error.message);
    return false;
  }
}
