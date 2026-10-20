# LifeKeel social presence kit

Everything needed to open and set up LifeKeel's social profiles in one sitting, with images, profile text, a
first set of posts and four weeks of a calendar. **Claude cannot create the accounts** (creating accounts and
entering passwords is something it must hand to a person), so steps 1 to 3 below are yours; the rest is ready to paste.

## 0. Rules every post follows

1. **Claims come from the registry.** Only say what is `live` in
   [`claims.ts`](../../apps/web/src/components/landing/claims.ts). Never say: "digital twin", "always on",
   "24/7", "no password", "magic link", "optimise", "save you money", "switch", "protect your family",
   "guaranteed", "autonomous". Keel does not "monitor" continuously.
2. **Information, not advice** (CLAUDE.md rule 2). Describe what is on file and what may be missing. Never "buy X",
   never name or compare insurers or products, never "switch". Point to "a licensed professional" for decisions.
   Every profile and every educational post carries: *Informational only, not financial advice.*
3. **No stories about real people** without written consent, and no invented testimonials, numbers or reviews.
4. **No account numbers, policy numbers, passwords or documents in comments or DMs**, ever, in either direction.
5. **Nothing automatic.** Posting is by a person, or through the operator console's approve-then-publish flow
   (see section 7). No auto-posting from the product, no auto-replies to DMs.

## 1. Choose names (check availability yourself)

Display name everywhere: **LifeKeel** (capital L and K).

Handle, in order of preference. Claim the same one on every network; if the first is taken, use the next for all:

1. `@lifekeel`
2. `@lifekeelhq`
3. `@getlifekeel`
4. `@lifekeel_uk`

Also register `lifekeel.co.uk` as the verified domain where a network supports it (Bluesky handle `lifekeel.co.uk`,
LinkedIn and Facebook website verification). A domain handle on Bluesky is free and reads as official.

## 2. Open the accounts safely

- Use a **shared company mailbox** (for example `social@lifekeel.co.uk`), not a personal address.
- Store logins in the company password manager; **app-based 2FA** (not SMS) on every account.
- At least **two people** are admins on LinkedIn and Facebook, so one lost phone cannot lock the company out.
- Do not give any network access to the product's connectors until section 7.
- Business accounts: Instagram and Facebook need a Meta Business account; create the Facebook Page first, then
  the Instagram professional account linked to it.

## 3. Priority order

| Order | Network | Why | Notes |
|---|---|---|---|
| 1 | LinkedIn Company Page | Credibility, partners, press, hiring | Banner 1584 x 396 |
| 2 | Bluesky | Cheap to start; the console can already post here | Banner 1500 x 500 |
| 3 | Instagram | Family finance and life-admin audience | Square cards, no banner |
| 4 | Facebook Page | Parents; link target for ads later | Banner 1640 x 624 |
| 5 | Threads | Reuses the Instagram account | Same bio |
| 6 | X | Search and press; low effort, same assets | Banner 1500 x 500 |
| Later | YouTube, TikTok | Only once there is video; each is a content commitment | |

Skip Mastodon until there is someone to read it.

## 4. Images (in [`social-assets/`](social-assets/))

Regenerate any time with `cd apps/web && node ../../scripts/social-assets.mjs` (needs network for fonts).

| File | Use |
|---|---|
| `avatar-1024.png` | Profile picture on every network (they crop to a circle; the mark sits inside the safe area) |
| `banner-linkedin-1584x396.png` | LinkedIn Company Page cover |
| `banner-x-bluesky-1500x500.png` | X header and Bluesky banner |
| `banner-facebook-1640x624.png` | Facebook Page cover |
| `card-1-chart-1080.png`, `card-2-bad-day-1080.png`, `card-3-cover-1080.png` | First square posts (Instagram, Threads, Facebook, LinkedIn) |

Banners keep the left quarter empty because the profile picture overlaps it. The mark itself is the app icon
(`apps/web/public/icon.svg`); see [`apps/web/public/logo/README.md`](../../apps/web/public/logo/README.md).
**Alt text for every image post:** describe the card in one sentence, for example "LifeKeel card: Your family's
chart, kept current."

## 5. Profile text (copy and paste)

Link everywhere: `https://lifekeel.co.uk/?utm_source=<network>&utm_medium=social&utm_campaign=profile`
(replace `<network>` with `linkedin`, `bluesky`, `instagram`, `facebook`, `threads`, `x`).

**Tagline (LinkedIn, 120 characters):**
`One home for your family's savings, cover and papers. Free to start.`

**LinkedIn About:**
> LifeKeel keeps your family's chart: what you hold on file, what looks missing, and the steps if something
> happens. Tell LifeKeel about your savings, cover and papers, and it shows where things stand, with a plain
> how-to-claim guide for each kind of policy and steps for seven kinds of bad day.
>
> It is informational only. LifeKeel names no insurer, ranks no policy, takes no commission and never moves
> money or buys anything for you. Your details are never sold, and you can export your data or delete your
> account yourself from Settings.
>
> Free to start, no credit card. Keel Plus (£7.99 a month, cancel any time) adds reading policy details from an
> uploaded document for you to confirm. Informational only, not financial advice.

Details to set: industry *Software Development* or *Financial Services* (pick the first; LifeKeel is not a
regulated firm), size 1 to 10, website, location. Do not use the word "advisor" anywhere on the page.

**Bluesky (256):**
`Your family's chart, kept current. Savings, cover and papers in one place, and the steps if something happens. Free to start. Informational only, not financial advice. lifekeel.co.uk`

**Instagram (150):**
`Your family's chart, kept current 🧭 Savings, cover & papers in one place. Free to start. Info only, not financial advice. ⬇️`
(Link in the profile; category *Personal Finance* or *Software*.)

**Facebook Page intro (255) and category (*Software* or *Education*):**
`LifeKeel keeps your family's chart: what you hold on file, what looks missing and the steps if something happens. Free to start. Informational only, not financial advice.`

**X (160):**
`Your family's chart, kept current. Savings, cover and papers in one place. Free to start. Informational only, not financial advice.`

**Threads:** use the Instagram bio.

## 6. First posts

Post one per day for the first ten days, in this order. Every post links to the site with the matching UTM
(`utm_campaign=launch`, `utm_content=<post number>`). Add the legal line to any post where space allows.

1. **The chart** (card 1). "Your family's chart, kept current. Tell LifeKeel what you hold on file and it shows
   what is there, what is missing, and the steps if something happens. Free to start. Informational only, not
   financial advice."
2. **What it is not.** "LifeKeel names no insurer, ranks no policy and gives no switching advice. It never moves
   money or buys anything for you. It shows what you have on file; decisions stay with you and, where you want
   one, a licensed professional."
3. **A hard day** (card 2). "If something happens, the first problem is finding the papers. LifeKeel has steps for
   seven kinds of bad day, built from what you have already entered."
4. **Cover on file** (card 3). "Life, income and health cover on file, set against a rough household estimate. It
   shows where the picture looks light. It does not say what to buy."
5. **Savings runway.** "How many months would your savings last if income stopped? LifeKeel works it out from the
   figures you enter, today and at a date you choose. Informational only."
6. **Renewals.** "Two policies for the same person? A renewal date coming up? LifeKeel lists both from what you
   have on file."
7. **Your data.** "Your details are never sold. You can export your data or delete your account yourself from
   Settings, no email needed."
8. **Guides.** One educational guide from [`guides-data.ts`](../../apps/web/src/app/guides/guides-data.ts) with its
   own link; summarise in three plain sentences.
9. **How to claim.** "A plain how-to-claim guide for each kind of policy, so the steps are written down before
   anyone needs them."
10. **Free to start.** "Free to start, no credit card. Keel Plus is £7.99 a month and can be cancelled; it reads
    policy details from an uploaded policy for you to confirm."

Each is under 280 characters as written, or trim to fit. Do not add emojis to LinkedIn.

## 7. Four-week calendar

Three posts a week per network is plenty; reuse one idea across networks with the network's own length.

| Week | Theme | Mon | Wed | Fri |
|---|---|---|---|---|
| 1 | Launch | Post 1 (chart) | Post 3 (hard day) | Post 2 (what it is not) |
| 2 | Cover and money | Post 4 (cover on file) | Post 5 (runway) | Post 7 (your data) |
| 3 | Guides | Guide A | Post 6 (renewals) | Guide B |
| 4 | How-to | Post 9 (how to claim) | Guide C | Post 10 (free to start) |

Review after four weeks with the funnel in the operator console: visits by `utm_source`, signups by source, and
which pillar earned replies. Drop the weakest network rather than posting thinly everywhere.

## 8. Connecting later (optional, not now)

The operator console can publish to Bluesky, Mastodon, LinkedIn, Facebook, Threads, Instagram and X with an
approve-then-publish flow (see `apps/api/src/marketing/social-publisher.ts`). Connect a network only after the
account is stable for a week, using a **new app password or token created for that purpose**, never the account
password. The connection page and storage are described in the console; credentials are encrypted at rest.

## 9. Community rules

- Reply to genuine questions within a working day; keep answers about what the product does.
- Never answer "what should I buy / who should I use / is this policy good". Say: "We cannot advise on that. A
  licensed professional can look at your whole situation."
- Move anything involving a person's data to the in-app Support page; never ask for it in a thread.
- Hide, do not argue with, abusive comments; report impersonation of LifeKeel immediately.
- No paid ads from these accounts until the legal pages are settled (Terms and Privacy placeholders) and a
  financial-promotion review has been done by counsel.

## 10. Launch checklist

- [ ] Handle chosen and the same on every network
- [ ] Company mailbox, password manager, app 2FA, two admins
- [ ] LinkedIn, Bluesky, Instagram (via Facebook Page), Facebook, Threads, X created in that order
- [ ] Avatar, banner, bio and link (with UTM) set; domain verified where offered
- [ ] Alt text added to every image
- [ ] First post scheduled; calendar copied into your scheduler
- [ ] Support contact and community rules shared with whoever replies
- [ ] Review date set for four weeks out
