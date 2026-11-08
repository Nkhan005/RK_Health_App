// Thin, typed wrapper around the Google Apps Script Web App.
// - text/plain body avoids a CORS preflight (Apps Script cannot answer OPTIONS)
// - every call has a timeout (AbortController) so the UI never hangs
// - errors are classified: network (retry later) vs server (rejected, don't retry) vs config
import { LIMITS } from './config.js';
import { getSettings } from './store.js';

export class ApiError extends Error {
  /** @param {string} message @param {'network'|'server'|'config'} kind */
  constructor(message, kind) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
  }
}

/**
 * @param {string} action e.g. "ADD_APPOINTMENT"
 * @param {object} payload
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<object>} the backend's JSON body (status === "success")
 */
export async function apiCall(action, payload = {}, { timeoutMs = LIMITS.requestTimeoutMs } = {}) {
  const url = getSettings().apiUrl?.trim();
  if (!url) throw new ApiError('No cloud backend configured (local mode)', 'config');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    throw new ApiError(timedOut ? 'The cloud took too long to respond' : 'Cannot reach the cloud backend', 'network');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new ApiError(`Cloud responded with HTTP ${response.status}`, 'network');

  let body;
  try {
    body = await response.json();
  } catch {
    throw new ApiError('Cloud returned an unreadable response', 'server');
  }
  if (body?.status !== 'success') throw new ApiError(body?.message || 'Cloud rejected the request', 'server');
  return body;
}
