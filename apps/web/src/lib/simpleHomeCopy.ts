// Adult mode's MODE_CONFIGS entry sets simpleLanguage: true, and Settings
// labels it "Simple language" right next to Organizer/Parent's "Full
// detail" — but until this, nothing on the actual home dashboard read that
// flag. Adult mode rendered byte-for-byte the same jargon ("readiness
// score reflects the gaps found in your profile", "insights") as
// Organizer/Parent, on the one screen every session opens on. Mirrors the
// same conditional-copy pattern already used for Child/Elderly mode
// (childHomeCopy.ts, elderlyHomeCopy.ts) rather than inventing a new one.
export function simpleHomeCopy(
  { hasLiveData, onTrack }: { hasLiveData: boolean; onTrack: boolean },
): { status: string; body: string } {
  if (!hasLiveData) {
    return { status: 'No data yet', body: 'Add your information to see your real score.' }
  }
  if (onTrack) {
    return { status: "You're on track", body: 'This shows how ready your family is. Add more details to make it more accurate.' }
  }
  return { status: 'A few things need a look', body: 'This shows how ready your family is. A few things below could use your attention.' }
}
