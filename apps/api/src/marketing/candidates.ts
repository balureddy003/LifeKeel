/**
 * Candidate supply (standing approvals, step 3): the part of the cycle that runs without a person.
 *
 * Each day, for every tenant with a live standing policy, Keel drafts at most one candidate per network
 * into the content bank when that network's bank is running thin. A candidate is only text waiting for a
 * human: it is never scheduled and never published until someone approves that exact text (marketing/bank.ts).
 * Drafting reuses the weekly plan's machinery (briefs, formats, hooks, cards) and the same governed model
 * task, so nothing here talks to a platform or a new model path.
 *
 * The stat-of-the-week format is left out on purpose: its sourced figures are not in the claims registry yet.
 */
import type { Db } from 'mongodb'
import type { LlmFn } from '@lifekeel/platform'
import { checkCopy } from './copy-guard.js'
import { BRIEFS, contentHash, pickBriefs } from './content-plan.js'
import { chooseFormat, chooseHook, loadFormats } from './formats.js'
import { plannableChannels, IMAGE_REQUIRED_CHANNELS } from './channels.js'
import { addCandidate, bankCollection, LINK_TOKEN, templatizeLink } from './bank.js'
import { policyCollection } from './standing.js'
import { draftPostText, learningContextBlock, siteLink } from '../routes/marketing-posts.js'

/** Approved plus waiting candidates per network, below which a new candidate is drafted. */
export const TARGET_ENTRIES_PER_CHANNEL = 12
/** The tag used while drafting; swapped for LINK_TOKEN so every scheduled post gets its own. */
const DRAFT_TAG = 'pdraft000'
/** Formats never drafted automatically (see the file header). */
const EXCLUDED_FORMATS = new Set(['stat_of_week'])

export interface CandidateRun {
  drafted: number
  skipped_full: number
  skipped_unusable: number
}

export async function draftCandidates(
  db: Db,
  llmFor: (tenantId: string) => LlmFn,
  now = new Date(),
): Promise<CandidateRun> {
  const run: CandidateRun = { drafted: 0, skipped_full: 0, skipped_unusable: 0 }
  const bank = bankCollection(db)
  const policies = await policyCollection(db)
    .find({ enabled: true, expires_at: { $gt: now } })
    .toArray()
  const defs = loadFormats()
  const formats = defs.formats.filter((f) => !EXCLUDED_FORMATS.has(f.id))

  for (const policy of policies) {
    const tenantId = policy.tenant_id
    const healthy = new Set((await plannableChannels(db, tenantId, now)).channels)
    const live = await bank
      .find({
        tenant_id: tenantId,
        $or: [{ status: 'candidate' }, { status: 'approved', expires_at: { $gt: now } }],
      })
      .toArray()
    const briefUsage = new Map<string, number>()
    const formatUsage = new Map<string, number>()
    const hookUsage = new Map<string, number>()
    for (const e of live) {
      if (e.brief_id) briefUsage.set(e.brief_id, (briefUsage.get(e.brief_id) ?? 0) + 1)
      if (e.format) formatUsage.set(e.format, (formatUsage.get(e.format) ?? 0) + 1)
      if (e.hook) hookUsage.set(e.hook, (hookUsage.get(e.hook) ?? 0) + 1)
    }
    const seenHashes = new Set(live.map((e) => e.content_hash))
    const takenFormats = new Set<string>()
    const takenHooks = new Set<string>()

    for (const channel of policy.channels) {
      if (!healthy.has(channel)) continue
      if (policy.paused_channels.some((p) => p.channel === channel)) continue
      const have = live.filter((e) => e.channels.includes(channel)).length
      if (have >= TARGET_ENTRIES_PER_CHANNEL) {
        run.skipped_full++
        continue
      }
      const brief = pickBriefs(briefUsage)[0] ?? BRIEFS[0]!
      const format = chooseFormat(formats, channel, formatUsage, takenFormats)
      const hook = chooseHook(defs.hooks, hookUsage, takenHooks)
      const campaign = `pillar_${brief.pillar}`
      const link = siteLink(channel, brief.path, DRAFT_TAG, campaign)
      const sourceBlock = `Topic: ${brief.title}\nFacts you may use (use nothing else):\n${brief.facts}${link ? `\nLink to include verbatim: ${link}` : ''}`
      const learning = await learningContextBlock(db, tenantId, channel)
      const { content: drafted } = await draftPostText(
        llmFor(tenantId),
        channel,
        sourceBlock,
        link,
        learning,
        format ?? undefined,
        hook,
      )
      const tpl = templatizeLink(drafted, DRAFT_TAG)
      const needsCard = IMAGE_REQUIRED_CHANNELS.has(channel) || channel === 'facebook'
      const card =
        needsCard && format?.card
          ? { layout: format.card, headline: brief.title, sub: format.card_sub }
          : undefined
      const unusable =
        !checkCopy(tpl.content.replace(LINK_TOKEN, link || ''), 'social').ok ||
        (IMAGE_REQUIRED_CHANNELS.has(channel) && !card) ||
        seenHashes.has(contentHash(tpl.content))
      if (unusable) {
        run.skipped_unusable++
        continue
      }
      const entry = await addCandidate(
        db,
        tenantId,
        'system:candidates',
        {
          content: tpl.content,
          channels: [channel],
          format: format?.id ?? null,
          hook: hook.id,
          pillar: brief.pillar,
          brief_id: brief.id,
          ...(tpl.link_path ? { link_path: tpl.link_path } : {}),
          campaign,
          ...(card ? { card, alt_text: `${brief.title} — LifeKeel` } : {}),
          source: 'candidate_job',
        },
        now,
      )
      seenHashes.add(entry.content_hash)
      briefUsage.set(brief.id, (briefUsage.get(brief.id) ?? 0) + 1)
      if (format) {
        takenFormats.add(format.id)
        formatUsage.set(format.id, (formatUsage.get(format.id) ?? 0) + 1)
      }
      takenHooks.add(hook.id)
      hookUsage.set(hook.id, (hookUsage.get(hook.id) ?? 0) + 1)
      run.drafted++
    }
  }
  return run
}
