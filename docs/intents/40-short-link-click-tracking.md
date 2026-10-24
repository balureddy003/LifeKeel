# Intent 40: short-link click tracking

**Problem** — Intent 15's visits-per-post only counts a visit when the landing
page's JS tracker fires a `growth_event`. A click that bounces (blocked script,
privacy mode, app webview) is invisible, so visits-per-post undercounts and the
funnel's first stage is unreliable.

**Done looks like**
- `GET /go/:tag` on the API: looks up the post by `post_tag`, logs an anonymous
  `growth_events` row (`event: 'link_click'`, meta `{src:'go'}` + tag), then
  302s to the post's stored link. Unknown tag → 302 to `/` or 404.
- Links minted at draft time use `/go/<tag>` instead of the raw UTM URL, so
  clicks are measured at redirect, independent of client JS.
- Posts table gains a `clicks` column alongside visits/signups; the rollup
  counts `link_click` events per tag.
- Public-route registry gets `/go/` with the rate-limit-only group note.
- Tests: valid tag → 302 + event row; bad tag → no event; no auth.

**Constraints**
- Tier 0 — redirects only; approval gate unchanged.
- Advice check — no copy added; the redirect target is the same UTM link the
  post already carried.
- Privacy — the event is anonymous (tag + timestamp); no IP, UA fingerprint,
  or cookie is stored.

**Out of scope** — link shortening service, vanity slugs, QR codes.

**Becomes** — PRD-222 once accepted.
