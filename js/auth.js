// Local privacy lock. The PIN is never stored in plain text: we keep a salted SHA-256
// hash (Web Crypto). Brute force is throttled with a lockout, and the app auto-locks
// when idle. NOTE: this is a device privacy screen, not server-side authentication.
import { LIMITS, STORAGE_KEYS } from './config.js';

const DEFAULT_PIN = '1234';
const PIN_RE = /^\d{4,6}$/;

function readAuth() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.auth) || 'null');
  } catch {
    return null;
  }
}

function writeAuth(record) {
  try {
    localStorage.setItem(STORAGE_KEYS.auth, JSON.stringify(record));
  } catch {
    /* storage unavailable: keep default PIN behaviour */
  }
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomSalt() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function buildRecord(pin, isDefault) {
  const salt = randomSalt();
  return { salt, hash: await sha256(`${salt}:${pin}`), isDefault, attempts: 0, lockedUntil: 0 };
}

/** Create the auth record on first run, migrating the v1 plain-text PIN if present. */
export async function initAuth() {
  if (readAuth()) return;
  let legacy = null;
  try {
    legacy = localStorage.getItem(STORAGE_KEYS.legacyPin);
    localStorage.removeItem(STORAGE_KEYS.legacyPin);
  } catch {
    legacy = null;
  }
  const pin = legacy && PIN_RE.test(legacy) ? legacy : DEFAULT_PIN;
  writeAuth(await buildRecord(pin, pin === DEFAULT_PIN));
}

export function isDefaultPin() {
  return readAuth()?.isDefault !== false;
}

/** @returns {Promise<{ok:boolean, lockedForMs?:number, attemptsLeft?:number}>} */
export async function verifyPin(pin) {
  const record = readAuth();
  if (!record) return { ok: false, attemptsLeft: LIMITS.maxPinAttempts };
  const now = Date.now();
  if (record.lockedUntil > now) return { ok: false, lockedForMs: record.lockedUntil - now };

  const ok = (await sha256(`${record.salt}:${pin}`)) === record.hash;
  if (ok) {
    writeAuth({ ...record, attempts: 0, lockedUntil: 0 });
    return { ok: true };
  }
  const attempts = record.attempts + 1;
  const locked = attempts >= LIMITS.maxPinAttempts;
  writeAuth({ ...record, attempts: locked ? 0 : attempts, lockedUntil: locked ? now + LIMITS.lockoutMs : 0 });
  return locked ? { ok: false, lockedForMs: LIMITS.lockoutMs } : { ok: false, attemptsLeft: LIMITS.maxPinAttempts - attempts };
}

/** @returns {Promise<{ok:boolean, error?:string}>} */
export async function changePin(currentPin, newPin) {
  if (!PIN_RE.test(newPin)) return { ok: false, error: 'PIN must be 4–6 digits' };
  if (newPin === DEFAULT_PIN) return { ok: false, error: 'Choose a PIN other than the demo PIN' };
  const check = await verifyPin(currentPin);
  if (!check.ok) return { ok: false, error: check.lockedForMs ? 'Too many attempts, try again shortly' : 'Current PIN is incorrect' };
  writeAuth(await buildRecord(newPin, false));
  return { ok: true };
}

/** Calls `onIdle` after `LIMITS.idleLockMs` without user input. Returns a stop function. */
export function startIdleLock(onIdle) {
  let timer;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(onIdle, LIMITS.idleLockMs);
  };
  const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
  events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
  reset();
  return () => {
    clearTimeout(timer);
    events.forEach((e) => window.removeEventListener(e, reset));
  };
}
