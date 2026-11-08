// Rule-based visit summary used ONLY when the AI backend is unreachable,
// so a demo or a patient on a bad connection still gets a structured draft.
// It is clearly labelled "offline draft" in the UI; it never pretends to be the LLM.

const MED_RE = /\b(\d+\s?(mg|mcg|ml|g)\b|tablet|tab\b|capsule|cap\b|syrup|inhaler|drops|ointment|injection|once daily|twice daily|thrice|bd\b|tds\b|od\b|times a day|before meals|after meals|post[- ]meal)/i;
const DX_RE = /\b(diagnos\w*|impression|suspected|likely|consistent with|assessment|condition|infection|deficiency|hypertension|diabetes|fever|pain)\b/i;
const FOLLOW_RE = /\b(follow[- ]?up|review|revisit|return|come back|repeat|recheck|in \d+ (day|week|month)s?)\b/i;
const ADVICE_RE = /\b(avoid|drink|rest|diet|exercise|walk|sleep|hydrat\w*|reduce|stop|monitor|keep)\b/i;

function splitSentences(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.trim().replace(/[.;]+$/, ''))
    .filter((s) => s.length > 2);
}

function bullets(list, empty) {
  return list.length ? list.map((s) => `- ${s}`).join('\n') : `- ${empty}`;
}

/** @returns {string} summary in the same section format the LLM is prompted to return */
export function summarizeOffline(rawNotes, patientName = 'the patient') {
  const sentences = splitSentences(rawNotes);
  // The opening sentence (usually the complaint) is the overview, unless it is clearly a prescription.
  const overview = sentences.length && !MED_RE.test(sentences[0]) ? [sentences[0]] : [];
  const used = new Set(overview);
  const pick = (re) => sentences.filter((s) => {
    if (used.has(s) || !re.test(s)) return false;
    used.add(s);
    return true;
  });
  const medicines = pick(MED_RE);
  const followUp = pick(FOLLOW_RE);
  const diagnosis = pick(DX_RE);
  const advice = [...pick(ADVICE_RE), ...sentences.filter((s) => !used.has(s))];

  return [
    'Visit Overview:',
    bullets(overview.length ? overview : [`Clinical visit notes recorded for ${patientName}.`], 'No overview provided'),
    'Diagnosis:',
    bullets(diagnosis, 'Not stated in the notes — confirm with your doctor'),
    'Medicine Instructions:',
    bullets(medicines, 'No medicines mentioned'),
    'Follow-up Advice:',
    bullets([...advice, ...followUp], 'Contact your doctor if symptoms persist or worsen'),
  ].join('\n');
}
