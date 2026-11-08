# Internship Review Guide — RK Health v2

## 1. What changed (v1 → v2)

| | v1 | v2 |
|---|---|---|
| **Data after refresh** | Cards existed only in the page; a refresh lost everything on screen | Offline-first store; full two-way sync with Google Sheets (`GET_ALL`) |
| **Report** | Scraped text out of DOM cards | Built from data: stats, adherence table, per-patient filter, PDF + CSV |
| **Medication tracking** | Free-text timing only | Multiple dose times, mark doses taken, 7-day adherence per medicine and overall |
| **Appointment compliance** | Not tracked | Auto status (upcoming / today / missed / attended), attendance % |
| **SMS reminders** | Phone stored, nothing sent on schedule | 15-minute trigger sends due reminders, skips doses already taken, never double-sends (SmsLog tab) |
| **AI summary** | Raw text block | Structured 4-section summary with strict anti-hallucination prompt; offline draft fallback |
| **Calendar** | Link only | Google Calendar link + `.ics` file with 1-hour alarm |
| **Security** | PIN stored and shown in plain text, `innerHTML` with user input (XSS) | Salted SHA-256 PIN, lockout, idle auto-lock, escaped templating, CSP, secrets in Script Properties |
| **Errors** | `alert()` popups, "Encrypting…" fake messages | Inline field validation, honest status pill (Synced / Offline / Local), toasts with Undo |
| **Code** | One 364-line script, duplicated fetch code | 17 small ES modules (state, sync, API, views), 15 unit tests |
| **Mobile** | Basic | Bottom tab bar, bottom-sheet dialogs, PWA install, works offline |

## 2. Five-minute demo script

1. **Lock screen** (15 s): "Privacy lock. The PIN is hashed, never stored in plain text. Five wrong tries lock it." Type a wrong PIN once to show the shake, then `1234`.
2. **Overview** (60 s): if empty, click *Load sample week*. Walk through the greeting sentence, adherence ring, *Doses today*, and the 7-day chart (hover a bar). Click **Take now** on a dose and watch the numbers update instantly.
3. **Visits** (60 s): filter chips → *Missed*. "Status is computed automatically from the time." Click **Mark attended** → toast offers *Summarize visit*.
4. **AI summary** (60 s): paste notes, for example
   `Pt c/o fever and sore throat x 3 days. Impression: viral pharyngitis. Tab Paracetamol 500mg TDS after meals for 3 days. Warm saline gargles. Review in 5 days.`
   Show the four sections and point out that abbreviations (TDS) are expanded for the patient.
5. **Medicines** (45 s): add a medicine with Morning + Night presets and a phone number. Show **Send reminder now** (a real SMS if Twilio is configured).
6. **Report** (30 s): Print / Save PDF and CSV export.
7. **Settings** (30 s): the *How RK Health works* card is your architecture slide; toggle dark mode at the end.

> **Before the review:** deploy the new `backend/Code.gs` (README step 5), run `setup()`, and do one dry run on the live URL.
> If the Wi-Fi fails during the demo, the app keeps working: changes queue locally and the AI falls back to a labelled offline draft.

## 3. Likely reviewer questions

**Why Google Apps Script + Sheets instead of Node + MongoDB?**
Zero hosting cost, no server to maintain, built-in access to Google services, and the sheet doubles as an admin panel. LockService handles concurrent writes. The trade-off is throughput, which is fine for a personal health app.

**How do you keep API keys safe on a static site?**
The frontend never sees a key. Groq and Twilio keys live in Apps Script *Script Properties*, and the browser only calls our Web App.

**Why `text/plain` for POST?**
Apps Script can't answer CORS preflight (`OPTIONS`) requests. A `text/plain` body is a "simple request", so the browser skips the preflight.

**What happens offline?**
Writes go to an outbox in localStorage and the UI updates immediately. The outbox flushes in order when the connection returns, retrying every 30 s. Network errors are retried; validation errors are dropped and shown to the user.

**How is adherence calculated?**
Doses whose scheduled time has passed (or that were taken early) count as "due". Adherence = taken ÷ due, per day and over 7/30 days. Paused medicines and days before the start date are excluded. This logic is unit-tested in `tests/domain.test.js`.

**How do you stop the AI from inventing things?**
Low temperature (0.2), a strict four-section format, an explicit rule never to add medicines or diagnoses missing from the notes, and the original notes are always shown next to the summary.

**Is the PIN real security?**
No, and the app says so: it is a device privacy screen. The next step would be Google Sign-In with per-user sheets.

**What would you build next?**
Google Sign-In / multi-user, caregiver view, refill reminders from pill counts, WhatsApp channel via Twilio, FHIR export.
