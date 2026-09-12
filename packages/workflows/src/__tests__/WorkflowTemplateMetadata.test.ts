/**
 * B3 (GOAL_PROGRESS_AND_UX_GAPS.md): verifies that the 14 workflow YAML
 * files that previously carried identical placeholder template metadata
 * (category: operations, required_connectors: [], same estimated_roi,
 * setup_minutes: 2) now have accurate per-workflow values.
 *
 * The originals were unrecoverably destroyed by the corruption documented
 * in TRADING_ENGINE_GAPS.md gap #16. The parse-level fix left identical
 * generic placeholders; this test ensures they've been reconstructed with
 * real per-workflow content.
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { repoRoot } from '@kairos/platform'

const ROOT = repoRoot()
const WORKFLOWS_DIR = path.join(ROOT, 'definitions', 'workflows')

// The 14 files that had placeholder metadata (from TRADING_ENGINE_GAPS.md #16)
const PLACEHOLDER_FILES = [
  'marketing_cart_abandonment.yaml',
  'marketing_new_lead_nurture.yaml',
  'marketing_review_request.yaml',
  'marketing_social_content.yaml',
  'marketing_upsell_campaign.yaml',
  'marketing_win_back_churned.yaml',
  'ops_cash_flow_alert.yaml',
  'ops_dispute_handler.yaml',
  'ops_failed_payment_retry.yaml',
  'ops_invoice_approval.yaml',
  'ops_new_booking_confirmation.yaml',
  'ops_staff_onboarding.yaml',
  'ops_weekly_business_digest.yaml',
  'support_ticket_triage.yaml',
]

const VALID_CATEGORIES = ['finance', 'ops', 'marketing', 'social', 'support', 'investing']

// The exact placeholder values that were in all 14 files before B3
const PLACEHOLDER_CATEGORY = 'operations'
const PLACEHOLDER_ROI = '£500–£5,000/month recovered'
const PLACEHOLDER_SETUP_MINUTES = 2

interface WorkflowTemplate {
  template?: {
    category?: string
    required_connectors?: string[]
    estimated_roi?: string
    setup_minutes?: number
    featured?: boolean
  }
}

function loadWorkflow(fileName: string): WorkflowTemplate {
  const filePath = path.join(WORKFLOWS_DIR, fileName)
  const content = fs.readFileSync(filePath, 'utf-8')
  return yaml.load(content) as WorkflowTemplate
}

describe('B3: workflow template metadata is accurate per-workflow', () => {
  it('all 14 previously-placeholder files have a template block', () => {
    for (const file of PLACEHOLDER_FILES) {
      const wf = loadWorkflow(file)
      expect(wf.template, `${file} has no template block`).toBeDefined()
    }
  })

  it('no file has the placeholder category "operations"', () => {
    for (const file of PLACEHOLDER_FILES) {
      const wf = loadWorkflow(file)
      expect(wf.template?.category, `${file} still has placeholder category`).not.toBe(PLACEHOLDER_CATEGORY)
    }
  })

  it('all files have a valid category', () => {
    for (const file of PLACEHOLDER_FILES) {
      const wf = loadWorkflow(file)
      expect(VALID_CATEGORIES, `${file} has invalid category: ${wf.template?.category}`).toContain(wf.template?.category)
    }
  })

  it('no file has the placeholder estimated_roi', () => {
    for (const file of PLACEHOLDER_FILES) {
      const wf = loadWorkflow(file)
      expect(wf.template?.estimated_roi, `${file} still has placeholder ROI`).not.toBe(PLACEHOLDER_ROI)
    }
  })

  it('no file has the placeholder setup_minutes of 2', () => {
    for (const file of PLACEHOLDER_FILES) {
      const wf = loadWorkflow(file)
      expect(wf.template?.setup_minutes, `${file} still has placeholder setup_minutes`).not.toBe(PLACEHOLDER_SETUP_MINUTES)
    }
  })

  it('no file has empty required_connectors', () => {
    for (const file of PLACEHOLDER_FILES) {
      const wf = loadWorkflow(file)
      expect(wf.template?.required_connectors?.length, `${file} has empty required_connectors`).toBeGreaterThan(0)
    }
  })

  it('each file has unique estimated_roi (no two files share the same ROI)', () => {
    const rois: Record<string, string> = {}
    for (const file of PLACEHOLDER_FILES) {
      const wf = loadWorkflow(file)
      const roi = wf.template?.estimated_roi ?? ''
      // Check uniqueness — if another file already has this exact ROI, fail
      for (const [otherFile, otherRoi] of Object.entries(rois)) {
        if (otherRoi === roi) {
          throw new Error(`${file} and ${otherFile} share the same estimated_roi: "${roi}"`)
        }
      }
      rois[file] = roi
    }
    // If we got here, all ROIs are unique
    expect(Object.keys(rois).length).toBe(PLACEHOLDER_FILES.length)
  })

  it('marketing workflows have category "marketing" or "social"', () => {
    const marketingFiles = PLACEHOLDER_FILES.filter(f => f.startsWith('marketing_'))
    for (const file of marketingFiles) {
      const wf = loadWorkflow(file)
      expect(['marketing', 'social'], `${file} should be marketing or social`).toContain(wf.template?.category)
    }
  })

  it('ops workflows have category "finance" or "ops"', () => {
    const opsFiles = PLACEHOLDER_FILES.filter(f => f.startsWith('ops_'))
    for (const file of opsFiles) {
      const wf = loadWorkflow(file)
      expect(['finance', 'ops'], `${file} should be finance or ops`).toContain(wf.template?.category)
    }
  })

  it('support_ticket_triage has category "support"', () => {
    const wf = loadWorkflow('support_ticket_triage.yaml')
    expect(wf.template?.category).toBe('support')
  })
})
