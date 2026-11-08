// Single source of truth for app data. Immutable updates + localStorage persistence
// (offline-first cache) + a tiny subscribe API so views re-render from state, not from the DOM.
import { DEFAULT_API_URL, STORAGE_KEYS } from './config.js';

const EMPTY_DATA = Object.freeze({
  appointments: [],
  medications: [],
  doseLogs: [],
  summaries: [],
  outbox: [],
  lastSyncAt: null,
});

const DEFAULT_SETTINGS = Object.freeze({ apiUrl: DEFAULT_API_URL, theme: 'system' });

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // private mode / quota: app keeps working in memory
  }
}

let state = Object.freeze(readJson(STORAGE_KEYS.data, EMPTY_DATA));
let settings = Object.freeze(readJson(STORAGE_KEYS.settings, DEFAULT_SETTINGS));
const listeners = new Set();

export function getState() {
  return state;
}

/** Apply a pure updater `(state) => partialState` and notify subscribers. */
export function update(updater) {
  state = Object.freeze({ ...state, ...updater(state) });
  writeJson(STORAGE_KEYS.data, state);
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Insert or replace an item (matched by id) in a collection, newest first. */
export function upsert(collection, item) {
  update((s) => {
    const exists = s[collection].some((x) => x.id === item.id);
    return {
      [collection]: exists
        ? s[collection].map((x) => (x.id === item.id ? { ...x, ...item } : x))
        : [item, ...s[collection]],
    };
  });
}

export function removeById(collection, id) {
  update((s) => ({ [collection]: s[collection].filter((x) => x.id !== id) }));
}

export function findById(collection, id) {
  return state[collection].find((x) => x.id === id) ?? null;
}

export function replaceAll(data) {
  update(() => ({ ...EMPTY_DATA, ...data }));
}

export function getSettings() {
  return settings;
}

export function saveSettings(patch) {
  settings = Object.freeze({ ...settings, ...patch });
  writeJson(STORAGE_KEYS.settings, settings);
  return settings;
}
