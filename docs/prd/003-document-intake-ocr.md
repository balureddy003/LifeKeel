# PRD-003 (backfill): Document intake and OCR extraction

*Retroactive PRD. See [001](001-family-onboarding-twin-graph.md) for the
template note.*

## Problem it solves

ARCHITECTURE.md's data-intake principle is explicit: "asking a family to
fill out six domains of forms will kill activation before the product
proves any value. Passive observation... is the primary intake channel;
manual entry is the fallback." Upload is the mechanism that principle
depends on.

## Market bar

See [000](000-market-landscape-and-positioning.md). Trustworthy's whole
category is built around document storage as the primary interaction;
Agent Oak's free/paid split (store for free, extract for a fee) is a
reasonable monetization wedge on top of that same mechanic, not a novel
one — the bar is Trustworthy's document-organization quality, which this
feature should be benchmarked against directly.

## Who it's for

Two different users of the same feature: free-tier households who just
want a secure place to keep a document, and paid households who want Oak
to read it for them.

## What's shipped

An upload flow ("Take Photo" / "Choose File") backed by
[documents.ts](../../apps/api/src/routes/documents.ts) +
`ocr/*.ts`, with a `FamilyDocument.status` state machine
(`'stored'` = uploaded and scanned, free on every plan, no field
extraction; `'uploaded'/'processing'/'extracted'/'error'` = the paid
GPT-4o-backed extraction pipeline). Verified live: the free tier's copy is
explicit and honest about the split ("Upgrade to have AI extract the key
details... automatically"), matching ARCHITECTURE.md's framing precisely.

## Trust tier

N/A — data storage and extraction, not a detector or action.

## Gaps to reach world-class

- **Extraction doesn't feed the financial-profile schema yet.** Per
  PRD-002's gap analysis, an extracted document currently doesn't trigger
  re-evaluation or auto-populate profile fields — it's stored as free-text
  extraction, not structured data flowing into `engine.evaluate()`. This
  is the single biggest thing standing between "we store your documents"
  (Trustworthy-parity) and "we understand your documents" (the actual
  product vision). PRD-102 depends on this for policy-document extraction
  specifically.
- **No document-type-aware guidance.** The UI treats "any financial
  document" uniformly; a world-class version would recognize what was
  just uploaded (payslip vs. insurance policy vs. mortgage statement) and
  route it to the right domain's schema, rather than leaving that mapping
  entirely to the extraction step.
- **No expiry/staleness tracking.** A document uploaded two years ago
  (an old insurance policy, an outdated payslip) has no visible "this
  might be stale" signal — relevant once PRD-102's renewal-window
  detector exists, since a stale document is exactly what that detector
  needs to distinguish from a current one.

## Success metrics

- **Free → paid conversion rate attributable to document upload** — the
  free/paid split exists specifically to monetize extraction; track
  whether "stored but not extracted" documents are actually driving
  upgrade intent (e.g., a paywall prompt shown after N stored documents).
- **Extraction accuracy / correction rate** — how often a user edits an
  AI-extracted field after the fact, as a proxy for whether the paid tier
  is actually delivering the promised value.
- **Upload → structured-field rate** (currently ~0%, per the gap above) —
  the metric that should move fastest once extraction is wired into the
  financial-profile schema.
