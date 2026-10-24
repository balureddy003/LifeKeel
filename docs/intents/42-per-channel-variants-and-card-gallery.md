# Intent 42: per-channel compose variants + card gallery

**Problem** — a plan item fans out one draft per channel, but the operator
can't tweak a channel's variant without editing each separately, and the
generated brand cards are invisible outside the per-post preview.

**Done looks like**
- Compose/plan detail shows per-channel variants side by side: the shared
  draft plus an editable textarea per channel; edits create per-channel
  overrides so the shared text stays the baseline.
- Card gallery on the marketing page: recent signed cards for IG/FB drafts
  in a grid, click to open the PNG.
- Overrides persist on the post doc (`variants.<channel>` or per-post edit);
  the content hash covers the variant actually approved.
- Tests: variant override edits only that channel's post; gallery lists only
  posts with signed card URLs; approval still hash-gated.

**Constraints**
- Tier 1 — drafting UI only.
- Advice check — edited variants re-run `checkCopy`.
- Privacy — operator-only surfaces; no new data.

**Out of scope** — per-channel scheduling times, channel groups, media
upload of user assets.

**Becomes** — PRD-224 once accepted.
