# Marketing story: expert review and refined narrative (1 November 2026)

Status: proposal for sign-off. No page copy has been changed by this document.
Inputs: the live landing source on `main` after PR #367, the brief-platform pivot
(`brief-platform-pivot-and-scale-2026-10.md`, including the 30 October direction
amendment), the earlier four-expert rebuild (`landing-and-conversion-rebuild-2026-10.md`),
and the beta check of the live site. Reviewed through four lenses: positioning,
conversion UX, trust and regulatory, and content. Nothing here was tested with real
visitors; every target is a hypothesis.

## 1. The new vision, stated once

LifeKeel is the place a household answers one dated money problem with **one number
both adults have seen**, and keeps that answer current. It never recommends a product.

Four ideas carry it: one problem, one evening, one number; the second adult reads
first and joins after; the record stays current (dated, re-opened when a date nears);
and it stays on the information side of the advice line.

## 2. Verdict

The product has moved to the brief platform; the page has only half moved. PR #367
put the problem cards first, but the words around them still sell the earlier vault.
A visitor reads a promise in the headline, is offered a different one two scrolls
down, and is billed for a third.

## 3. Findings, most severe first

| # | Lens | Finding | Where |
|---|---|---|---|
| 1 | Positioning | The H1 is "Your family's money, cover and papers. One bright place." The lede promises "what is on file... and the steps to take". Neither mentions the number, the other adult or a date, so the strongest idea sits below the fold. | `VividHero.tsx:44-50` |
| 2 | Positioning | The page title and meta still read "cover and next steps, kept in one place" (storage framing, the crowded layer per the pivot doc). | `app/layout.tsx:60` |
| 3 | Conversion | The hero button says generic sign-up. The problem cards carry the brief id, but the hero and pricing buttons do not, so the strongest entry is a second click. | `VividHero.tsx`, `VividSections.tsx` pricing |
| 4 | Story | The "confirmed open" moment, the thing no vault offers, appears only as a clause in the problems intro. It deserves its own beat: you will see when they have opened it. | `ThreeProblems` intro |
| 5 | Story | "Three steps to a clearer picture" repeats the vault flow (add what you hold, Keel checks, next step). Re-cast as: pick the problem, enter a few figures, send the link. | `STEPS` |
| 6 | Pricing | Plus is sold as "reads policy documents" and £7.99/month, while the pivot decided the paid unit is the second brief and keeping the record (£59.99/yr, one decision). Document reading is also the least-tested feature. | `PlusBand`, `Pricing.tsx` |
| 7 | Trust | The trust block is strong ("six things Keel does not do"). It is a differentiator against distribution-led rivals and should move up, directly under the problem cards. | `Trust` |
| 8 | Regulatory | Card copy is factual ("how many months could the household run"). Keep it that way: no verb telling a visitor what to buy or change. The advice-rule test scans the files listed in it, not the landing strings, so a new landing constant needs adding to that list. | `advice-rule.test.ts` |
| 9 | Honesty | Five capabilities are still `live: false` (partners' overlap, monthly letter about what changed, named outside person, claim guide per policy, new life-event checks). The refined story must not lean on them; the dated re-open prompt is not built either. | `capabilities.ts` |

## 4. Refined story (proposed copy)

Everything below uses only live behaviour. Where a line depends on something not
built, it is marked **(needs build)** and left out of the first pass.

**Headline:** *One money question. One number. Both of you.*
**Lede:** Pick the problem in front of your household: an income that stops or drops,
a mortgage fix ending, fees starting. Enter a few figures and Keel gives one answer in
months, with the date it depends on. Send it to the other adult and you will see when
they have opened it.
**Primary button:** *Start your first brief. It is free.* (goes to `/signup`, carries
no brief id until the visitor picks a card)
**Secondary:** *See the six problems* (anchors to the problem cards)

**Beat 1, the problems (already shipped).** Keep the six cards.

**Beat 2, the moment that matters.** Heading: *Not just a number. A number you can
both see.* One short paragraph and a small picture of the two-adult states:
"Sent", "Opened", "Both seen the same months". **(Only the opened state is live;
show no state that is not.)**

**Beat 3, what it will not do.** Move the existing trust block here. Lead line:
*No commissions, no product picks, nothing done without your yes.*

**Beat 4, how it works.** Rewrite to: *Choose the problem. Enter a few figures. Send
the link.* Three steps, no readiness language.

**Beat 5, keeping it current (the paid story).** Heading: *Keep the answer true as
life moves.* Free: the first brief and the other adult reading it. Paid: further
briefs and a record kept current. Document reading becomes one line under it, not the
lead. Pricing figure to be set to the single decision in the pivot doc by the owner
**(needs your decision: price and copy)**.

**Beat 6, the bad day.** Keep Emergency Mode, but as the last story, as relief rather
than the lead. Only claim what is live: steps for the kinds of event Emergency Mode
offers.

Remove or demote: the "Made-up household" mock as the hero visual (replace with a
labelled sample brief result), "Ready before. Found during. Sorted after." (keep as
a quiet capability list at the foot).

## 5. What I recommend building, in order

1. **Hero, lede and page title** to the new line (copy only, one PR).
2. **Trust block up, steps rewritten, hero visual replaced** by a sample brief result
   labelled sample (copy plus one component).
3. **Pricing copy** aligned to the second-brief and record entitlement, after you set
   the price.
4. Later, with a build and a tier decision: the dated re-open prompt (a notification
   path, so it needs its trust tier named) and "partial" labelling when one adult
   keeps figures private (not confirmed in code, to be checked first).

## 6. Questions for the owner

- Is the headline above the line you want, or do you prefer the earlier
  "see how long your family could stay steady"?
- Price and paid unit: £7.99/month with document reading, or the £59.99/year record
  from the pivot doc?
- Do you want a sample brief result as the hero visual? It is the one thing that
  shows the number without an account, and it is made-up data, clearly labelled.

## 7. Not verified

No visitor testing. I did not read the full FAQ, blog or guide pages, nor check the
live site's metadata. The partial-result and dated-prompt claims in section 5 were
not confirmed in code.
