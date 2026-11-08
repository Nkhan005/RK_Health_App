// AI visit summaries rendered as structured, scannable sections.
import { parseSummarySections } from '../domain.js';
import { html, icon } from '../ui.js';

const SECTION_ICON = { overview: 'heart', diagnosis: 'report', medicine: 'pill', medication: 'pill', follow: 'calendar', advice: 'calendar' };

function sectionIcon(title) {
  const key = Object.keys(SECTION_ICON).find((k) => title.toLowerCase().includes(k));
  return icon(SECTION_ICON[key] || 'sparkles', 16);
}

function sourceBadge(summary) {
  if (summary.model === 'offline-draft') return html`<span class="badge badge-missed" title="Generated on-device because the AI service was unreachable">Offline draft</span>`;
  return html`<span class="badge badge-ai">${icon('sparkles', 12)} ${summary.model || 'AI'}</span>`;
}

function summaryCard(summary) {
  const sections = parseSummarySections(summary.summary);
  return html`
    <article class="sum-card">
      <header class="sum-head">
        <div>
          <h3>${summary.patientName}</h3>
          <p class="muted small">${new Date(summary.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
        </div>
        ${sourceBadge(summary)}
      </header>
      <div class="sum-sections">
        ${sections.map((s) => html`
          <section class="sum-section">
            <h4>${sectionIcon(s.title)} ${s.title}</h4>
            <ul>${s.lines.map((l) => html`<li>${l}</li>`)}</ul>
          </section>`)}
      </div>
      <details class="sum-raw"><summary>Original doctor notes</summary><p>${summary.rawNotes}</p></details>
      <footer class="sum-foot">
        <button class="chip-btn" data-action="copy-summary" data-id="${summary.id}">${icon('copy', 14)} Copy</button>
        <button class="chip-btn chip-danger" data-action="delete-summary" data-id="${summary.id}" aria-label="Delete summary">${icon('trash', 14)}</button>
      </footer>
    </article>`;
}

export function renderSummaries(state) {
  if (!state.summaries.length) {
    return html`<div class="empty-state">${icon('sparkles', 32)}<p>Paste a doctor's notes and get a short, plain-language summary with diagnosis, medicines and follow-up.</p>
      <button class="btn btn-primary" data-action="open-dialog" data-dialog="ai-dialog">${icon('sparkles')} New AI summary</button></div>`;
  }
  const sorted = [...state.summaries].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return html`<div class="sum-list">${sorted.map(summaryCard)}</div>
    <p class="disclaimer">${icon('heart', 14)} AI summaries help you understand your visit. They are not medical advice; always follow your doctor's instructions.</p>`;
}
