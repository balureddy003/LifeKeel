/**
 * Acute-emergency screen for free-text family input (Ask Keel, member asks).
 *
 * Not an LLM guard — a deterministic safety classifier that must fire
 * regardless of whether any model is configured, so a "chest pain"-type
 * message always gets emergency guidance and never a finance-grounded
 * answer or the generic fallback. Twin of
 * apps/web/src/lib/emergency-detection.ts — kept byte-identical in
 * intent: the client screens before the query leaves the device, the
 * server re-screens independently so a stale or crafted client can't
 * miss it. If you change one side, change the other.
 */

export type EmergencyKind = 'medical' | 'self_harm'

// Word-level acute-event phrases. Bare "emergency"/"ambulance" are
// deliberately excluded: coverage questions ("am I covered for a medical
// emergency?") are a normal Ask Keel topic, not an in-progress event.
// False positives cost a safety notice — acceptable; false negatives are
// the defect this exists to prevent.
const MEDICAL_EMERGENCY_RE =
  /\b(chest[\s-](pain|pains|tight(ness)?|pressure|hurts?|hurting)|heart[\s-]attack|cardiac[\s-]arrest|can'?t[\s-]breathe|cannot[\s-]breathe|not[\s-]breathing|stopped[\s-]breathing|difficulty[\s-]breathing|trouble[\s-]breathing|struggling[\s-]to[\s-]breathe|short(ness)?[\s-]of[\s-]breath|choking|unconscious|unresponsive|passed[\s-]out|collaps(ed|ing|es)|overdos(e|ed|ing)|took[\s-]too[\s-]many[\s-](pills|tablets|meds|medication)|severe(ly)?[\s-]bleeding|bleeding[\s-](heavily|badly|won'?t[\s-]stop|uncontrollably)|won'?t[\s-]stop[\s-]bleeding|stroke|slurred[\s-]speech|face[\s-](is[\s-])?drooping|seizure|convuls|anaphylaxis|anaphylactic|severe[\s-]allergic[\s-]reaction|throat[\s-](is[\s-])?(closing|swelling)|swallowed[\s-](a|an|the|some|his|her|their|my)?[\s-]*(poison|bleach|tablets|pills|batter|battery)|call[\s-](an[\s-])?(ambulance|999|911|112)|need[\s-](an[\s-])?ambulance|heart[\s-]stopped)\b/i

const SELF_HARM_RE =
  /\b(suicide|suicidal|kill(ing|s)?[\s-](myself|himself|herself|themselves)|end(s|ing)?[\s-](my|his|her|their)[\s-](own[\s-])?li(fe|ves)|end(ing)?[\s-]it[\s-]all|take[\s-](my|his|her|their)[\s-]own[\s-]li(fe|ves)|self[-\s]?harm|want(s)?[\s-]to[\s-]die|(don'?t|do[\s-]not|doesn'?t|does[\s-]not)[\s-]want[\s-]to[\s-](live|be[\s-](here|alive)|exist|go[\s-]on|wake[\s-]up)|no[\s-](reason|point)[\s-]((to|in)[\s-])?(live|living|going[\s-]on|being[\s-]alive)|can'?t[\s-]go[\s-]on[\s-](living|like[\s-]this|anymore)|better[\s-]off[\s-]dead|wish[\s-](i|he|she|they)[\s-](was|were)[\s-]dead|wish[\s-](i|he|she|they)[\s-](had|hadn'?t|were|was)[\s-]never[\s-](been[\s-]born|born)|hurt(ing)?[\s-](myself|himself|herself|themselves)|cutting[\s-](myself|himself|herself|themselves))\b/i

/**
 * The kind of acute emergency the text describes, or null. It is a
 * screening signal — callers answer with deterministic safety guidance,
 * never model output.
 */
export function detectEmergency(text: string): EmergencyKind | null {
  const normalized = text
    .normalize('NFKC')
    // Zero-width chars — obfuscation that hides trigger words.
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
  if (SELF_HARM_RE.test(normalized)) return 'self_harm'
  if (MEDICAL_EMERGENCY_RE.test(normalized)) return 'medical'
  return null
}
