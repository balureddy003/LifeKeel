# Distribution playbook — founder-run, ~3h/week

Where to show up, what to say, how to measure it. Every link tagged via
`scripts/utm-link.mjs`; every draft passes `checkCopy` (kind `social`). The
founder performs every action — no software posts, replies or emails.

> **Research status (2026-10-24):** venue selection is from the competitive
> review set (`docs/reviews/`, `docs/prd/000`); **each venue's rules must be
> re-verified against its own rules page on the day you post** — marked
> *verify* below. Nothing here is asserted from memory as current.

## Compliance guardrails (keep open while posting)

- Never promise outcomes; never recommend or name providers; where a thread
  asks for a recommendation, point to "a licensed professional" / "compare
  quotes from multiple insurers".
- Always disclose you're the builder. No fake accounts, no astroturf, no
  scraping, no unsolicited DMs. Respect each venue's self-promotion rules.

## Ranked venues

| # | Venue | Why it fits | Effort/wk | `utm_content` | Rules |
|---|-------|-------------|-----------|---------------|-------|
| 1 | r/UKPersonalFinance | Largest UK money community; bereavement-admin threads recur | 45m | a01 | No self-promo — answer helpfully, link only if asked. *Verify* |
| 2 | Mumsnet money/legal talk | Family-admin pain lives here | 45m | a02 | Strict on promo; founder-disclosed posts only. *Verify* |
| 3 | Bereavement support communities (e.g. Sue Ryder) | "Where are the papers" is the lived problem | 30m | a03 | Sensitivity first; help, don't market. *Verify* |
| 4 | Facebook groups: UK parents / widows-widowers | Direct audience | 30m | a04 | Each group's own promo day/rules. *Verify* |
| 5 | Show HN (Hacker News) | Builder audience, tolerates launches | one-off | a05 | Be present in comments. *Verify* |
| 6 | Indie/builder communities (Indie Hackers, Bluesky starter packs) | Peer distribution | 30m | a06 | Build-in-public norms. *Verify* |
| 7 | LinkedIn founder posts | Second-adult/professional audience | 30m | a07 | Own feed, low risk. |
| 8 | Free directories (alternativeTo, SaaSHub-type, fintech lists) | Slow-burn inbound | one-off | a08 | Free listings only. *Verify* |
| 9 | Newsletter/podcast swaps (family finance, grief-admin) | Borrowed audiences | one-off | a09 | Outreach note below. |
| 10 | Solicitor/will-writer/adviser conversations | Referral channel — **information sharing only** (PRD-207: never arrange or steer) | as it happens | a10 | No commissions; they stay the family's own professional. |

## 4-week sprint (≤3h/week; week 1 is conversations, not posts)

| Week | Actions |
|------|---------|
| 1 | 2 helpful answers in venues 1–2 (no link). Create free listings (8). Tag links with `scripts/utm-link.mjs`. |
| 2 | "What I'm building" post on own Bluesky/LinkedIn (7) + 2 more answers. |
| 3 | Show HN (5) + one newsletter outreach (9). |
| 4 | Review: visits/signups per action in the Posts table; repeat best, drop worst. |

## Draft messages (run through `checkCopy`, kind `social`; re-run if edited)

```draft
I'm building LifeKeel — a place where a family can see what's on file
(savings, cover, papers) and, on a hard day, the steps written down before
anyone needs them. Information only — it never recommends products. Free to
start. Happy to answer questions.
```

```draft
If something happened tomorrow, could your family find the will, the
policies, the pension paperwork? That's the gap LifeKeel is built around —
it shows what's on file and what looks missing. Free to start.
```

Outreach note (newsletters/podcasts): same two sentences + "I'm the builder —
happy to share what we've learned about how families actually keep (and lose)
their paperwork."

## Weekly 15-minute review

What was done → visits and signups per action (Operator → Marketing → Plan →
Posts table; links tagged `utm_campaign=playbook`) → one thing to repeat, one
to drop. Becomes the input to the PRD-221 weekly brief once it exists.
