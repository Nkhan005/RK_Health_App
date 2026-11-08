// Central configuration. The backend URL can be overridden at runtime in Settings
// (stored in localStorage), so a new Apps Script deployment never needs a code change.

export const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbxbOlpMMPrgUpiP8GhfVgnxuv9HauGCTLV4Bw4PUTfttvKgdemgvQRcer7_N2g8k0lzhQ/exec';

export const STORAGE_KEYS = Object.freeze({
  data: 'rk_health_data_v2',
  settings: 'rk_health_settings_v2',
  auth: 'rk_health_auth_v2',
  legacyPin: 'rk_health_pin',
});

export const LIMITS = Object.freeze({
  requestTimeoutMs: 20_000,
  aiTimeoutMs: 45_000,
  maxPinAttempts: 5,
  lockoutMs: 30_000,
  idleLockMs: 5 * 60_000,
  adherenceDays: 7,
});

export const APP_VERSION = '2.0.0';
