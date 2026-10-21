/**
 * Acute-emergency screen for Ask Keel input — twin of
 * packages/platform/src/emergency.ts. Deterministic and on-device: a
 * "chest pain"-type message gets the safety reply instantly, even
 * offline or while the assistant backend is down, and the text never
 * leaves the device. The server screens the same query independently.
 * Kept byte-identical in intent — if you change one side, change the other.
 */

export type EmergencyKind = 'medical' | 'self_harm'

const MEDICAL_EMERGENCY_RE =
  /\b(chest[\s-](pain|pains|tight(ness)?|pressure|hurts?|hurting)|heart[\s-]attack|cardiac[\s-]arrest|can'?t[\s-]breathe|cannot[\s-]breathe|not[\s-]breathing|stopped[\s-]breathing|difficulty[\s-]breathing|trouble[\s-]breathing|struggling[\s-]to[\s-]breathe|short(ness)?[\s-]of[\s-]breath|choking|unconscious|unresponsive|passed[\s-]out|collaps(ed|ing|es)|overdos(e|ed|ing)|took[\s-]too[\s-]many[\s-](pills|tablets|meds|medication)|severe(ly)?[\s-]bleeding|bleeding[\s-](heavily|badly|won'?t[\s-]stop|uncontrollably)|won'?t[\s-]stop[\s-]bleeding|stroke|slurred[\s-]speech|face[\s-](is[\s-])?drooping|seizure|convuls|anaphylaxis|anaphylactic|severe[\s-]allergic[\s-]reaction|throat[\s-](is[\s-])?(closing|swelling)|swallowed[\s-](a|an|the|some|his|her|their|my)?[\s-]*(poison|bleach|tablets|pills|batter|battery)|call[\s-](an[\s-])?(ambulance|999|911|112)|need[\s-](an[\s-])?ambulance|heart[\s-]stopped)\b/i

const SELF_HARM_RE =
  /\b(suicide|suicidal|kill[\s-](myself|himself|herself|themselves)|end[\s-](my|his|her|their)[\s-]life|end[\s-]it[\s-]all|self[-\s]?harm|want(s)?[\s-]to[\s-]die|don'?t[\s-]want[\s-]to[\s-](live|be[\s-]here|exist)|no[\s-]reason[\s-]to[\s-]live|better[\s-]off[\s-]dead|wish[\s-](i|he|she|they)[\s-](was|were)[\s-]dead|hurt(ing)?[\s-](myself|himself|herself|themselves)|cutting[\s-](myself|himself|herself|themselves))\b/i

export function detectEmergency(text: string): EmergencyKind | null {
  const normalized = text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '')
  if (SELF_HARM_RE.test(normalized)) return 'self_harm'
  if (MEDICAL_EMERGENCY_RE.test(normalized)) return 'medical'
  return null
}

/** Same text the API returns for an emergency-flagged query. */
export const EMERGENCY_REPLY: Record<EmergencyKind, string> = {
  medical:
    "If this is happening right now, call emergency services — 999 in the UK, 911 in the US, 112 in the EU, or your local emergency number. Don't wait.\n\n" +
    "Keel is a finance app — it can't help with a medical emergency. Once everyone is safe, I can help with what comes after: health cover on file, your emergency fund, or who's listed as a contact.",
  self_harm:
    "If you or someone you're with might be in danger right now, call emergency services — 999 in the UK, or your local emergency number. You can also talk to Samaritans any time on 116 123 — free in the UK and Ireland, 24/7.\n\n" +
    "Keel is a finance app, not a crisis line — but once you're safe, I'm here for the practical side whenever you need it.",
}
