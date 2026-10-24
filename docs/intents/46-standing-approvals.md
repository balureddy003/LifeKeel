# Intent 46: Standing approvals — an autonomous marketing engine with a human gate

**Problem** — Every public post needs a person's click (intent 03). That keeps the engine safe but means a
weekly chore of approving 9 to 18 posts, and the engine stops the moment the chore is skipped. The owner
wants the engine to run on its own without giving up the rule that a named human approves every public text.

**Done looks like**
1. **A content bank.** A bank entry is one exact post text a named human reviewed. Approving it names the
   hash of the text the reviewer saw; it must pass the copy guard and, where a network needs an image, have
   a card or image. Approved entries are immutable and expire after 90 days.
2. **A standing policy**, set by a human with `marketing.manage`, a recorded reason and an expiry of at most
   30 days: which networks, posts per network per day and week (defaults 1 and 3), minimum gap (24 h), no
   repeat on a network inside 45 days, and Europe/London posting hours (08:00 to 20:00).
3. **A scheduler** that, daily, turns approved bank entries into posts in state `approved` within that
   policy. Each post carries `approved_by` and `approved_at` of the human who approved the bank entry,
   `approved_via: 'standing'` and a `bank_entry_id`. The only part that differs from the approved text is a
   freshly tagged tracking link in place of `{{link}}`, so per-post attribution still works. The scheduler
   never publishes: posts go through the unchanged publish path, so `marketing_paused`, `dry_run_mode` and
   the send-time copy-guard recheck still apply.
4. **Circuit breakers.** Two publish failures in a row pause that network only. An approval that expires, or
   an entry whose text no longer passes the current copy rules, is retired and its unsent posts are rejected.
   Unhealthy connections are skipped. Revoking rejects every unsent standing post at once.
5. **Candidate supply.** A daily job drafts at most one candidate per network into the bank when that
   network has fewer than 12 approved-plus-waiting entries. Candidates are text waiting for a person; they
   are never scheduled until approved. The stat-of-the-week format is excluded until its figures are in the
   claims registry.
6. **Visibility.** Mission Control raises: a paused network, an expired or expiring approval, a thin bank
   and drafts waiting. The Marketing console has an Autonomy tab for all of the above.

**Constraints**
- Trust tier touched: **2**. A human approves each exact text by content hash (the same act as approve-the-
  week) and enables the policy with a reason and an expiry. The scheduler holds no authority of its own.
  `NEVER_AUTONOMOUS` is unchanged and still lists `marketing.publish`, `marketing.approve` and `social.post`;
  the policy is not an autopilot rule and cannot be enabled by one.
- `trust-tier-gate.test.ts` pins the second door to the approved state: only `marketing/standing.ts` may
  insert already-approved posts, `approved_by` must come from the bank entry, and the scheduler may not call
  `createPost`, `publishPost` or any executor. `publishPost` call sites stay at two.
- Regulated-advice check: the bank only holds text that passed `checkCopy`; it is re-checked at scheduling
  and at send time; a rule change retires failing entries. Candidate text is generated through the existing
  governed task and never from family content.
- Data/privacy limits: public marketing text only; no new trackers; the bank and policy are tenant-scoped and
  listed in the erasure catalogue.

**Honest limits**
- There is no signal for "this post is landing badly" (no sentiment or reply analysis). Breakers see publish
  failures, dead connections, expiry and changed rules, not taste. The protection is that every text was
  approved by a person, caps are small, approvals expire, and revoking is one click.
- Nothing was verified against live platforms; tests use fakes and a throwaway database.

**Out of scope** — unattended model-written posts (would reverse intent 03 and need its own Tier 3 design),
replies, DMs and comments, community answers, directories, Pinterest, paid ads, Search Console read-back
(needs a Google service account), the learner (intent 19).

**Becomes** — docs/prd/222-standing-approvals.md

## Proposed clarification for CLAUDE.md rule 1 (your call; not applied)

> A human approving exact text, with a recorded reason and expiry, may authorise the engine to schedule that
> text within caps the human set. The engine may not author, change or approve public text, and
> `NEVER_AUTONOMOUS` still applies to every autopilot rule.

## Build record

Stacked draft PRs: bank (#233), scheduler and breakers (#234), candidate job and alerts (#235), Autonomy tab
(#236), and this document. Defaults to confirm: 30-day policy expiry, 3 posts per network per week,
90-day bank life, 08:00 to 20:00 London window, start with 2 or 3 networks.
