# UX 5-star iteration 1 (2026-11)

Method: pick the biggest remaining gap, smallest change that reuses an existing pattern, test at phone width
(375px), record what changed and what is left. Tier 0 only; no copy recommends or names a product.

## Criteria and where each stands

| Criterion | State | Evidence |
|---|---|---|
| Value in under 60 s | Mostly. Start-here card asks for one policy; the mismatch shows as typed. Provider name is required. | #572. Not timed end to end. |
| Mismatch flagged in plain words | Done. "£42 a month adds up to £504 a year. You entered £500 a year, £4 less…" | Seen on staging; sim scenario 28. |
| Partner opens list, confirms, both see status | Built: join link, "Who has looked" card with dates, one-tap confirm; Home's top card now asks the viewer to confirm. | #565, #579. API half passes in sim (01, 07). Emailed-link join and a real second adult not walked. |
| Change a key number | Done in place on the income page. Home refreshes after a policy add or edit. | #573, #574, #578. |
| Emergency in one or two taps | Done on Home, What If, Family, Domains, Inbox, Finances, Briefs. No floating button (owner decision). | #582. |
| No NaN or blank | Held in earlier passes; zero income handled. | resilience tests. |
| Reusable patterns | Services registry drives tiles, emergency sections and the "Who has looked" card; car and travel use it. | #566, #575. |
| Calm | Install hint stays off form pages; verify banner is slim and dismissible for 3 days. | #580. |

## Gaps left
- Walk the partner side on staging with a second account and the emailed link (needs a mail token).
- Time the first value from signup with a stopwatch on a real phone.
- Property has no emergency pack, so that event shows nothing.
- Inline figure edit on the income page can still sit under the install hint.
- Moving the API image to a newer Node (install pnpm without corepack; test on it).
