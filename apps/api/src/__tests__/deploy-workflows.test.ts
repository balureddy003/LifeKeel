/**
 * Production and staging deploy separately. The production web deploy published every Firebase site,
 * including staging, with the production build, which broke the staging site (it carried the
 * production API origin and has no /api rewrite). These tests keep the two apart:
 *  - the production deploys never name staging, and the web deploy names its three targets;
 *  - the staging deploy has its own GitHub environment, hard-coded staging names, an image-only
 *    update that cannot touch settings or secrets, one Firebase target, and refuses a production API.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { load as loadYaml } from 'js-yaml'

const REPO = resolve(__dirname, '..', '..', '..', '..')
const read = (f: string) => readFileSync(join(REPO, '.github', 'workflows', f), 'utf8')
type Job = { environment?: string; needs?: unknown; if?: string; uses?: string }
const jobs = (f: string) => (loadYaml(read(f)) as { jobs: Record<string, Job> }).jobs

describe('the production deploys', () => {
  it('the web deploy publishes the three production sites and never the staging site', () => {
    const web = read('deploy-web.yml')
    expect(web).toMatch(
      /firebase deploy --only hosting:family,hosting:landing-uk,hosting:landing-si /,
    )
    expect(web).not.toMatch(/--only hosting "/)
    expect(web).not.toMatch(/hosting:staging|lifekeel-staging/)
  })

  it('neither production deploy mentions staging', () => {
    expect(read('deploy-web.yml')).not.toMatch(/staging/i)
    expect(read('deploy-api.yml')).not.toMatch(/staging/i)
  })

  it('both keep the production environment', () => {
    expect(jobs('deploy-web.yml')['deploy']?.environment).toBe('production')
    expect(jobs('deploy-api.yml')['deploy-api']?.environment).toBe('production')
  })
})

describe('the staging deploy', () => {
  const exists = existsSync(join(REPO, '.github', 'workflows', 'deploy-staging.yml'))
  const src = () => read('deploy-staging.yml')

  it('exists', () => expect(exists).toBe(true))

  it('is manual, from main only, and waits for green CI on the exact commit', () => {
    const doc = loadYaml(src()) as { on: Record<string, unknown>; jobs: Record<string, Job> }
    expect(Object.keys(doc.on)).toEqual(['workflow_dispatch'])
    expect(src()).toMatch(/refs\/heads\/main/)
    expect(doc.jobs['verify-ci']?.uses).toBe('./.github/workflows/require-ci.yml')
    expect(doc.jobs['deploy-api']?.needs).toBe('verify-ci')
    expect(doc.jobs['deploy-web']?.needs).toBe('verify-ci')
  })

  it('uses its own GitHub environment, never production', () => {
    const j = jobs('deploy-staging.yml')
    expect(j['deploy-api']?.environment).toBe('staging')
    expect(j['deploy-web']?.environment).toBe('staging')
    expect(src()).not.toMatch(/environment:\s*production/i)
  })

  it('names only staging resources, and never the production service, secrets or key', () => {
    const s = src()
    expect(s).toMatch(/STAGING_SERVICE:\s*lifekeel-api-staging\b/)
    expect(s).toMatch(/:staging-\$\{\{ env\.RELEASE_SHA \}\}/)
    expect(s).not.toMatch(/\blifekeel-api\b(?!-staging)/)
    expect(s).not.toMatch(/\blifekeel-[a-z-]+:latest/)
    expect(s).not.toMatch(
      /secrets\.GCP_SA_KEY|secrets\.FIREBASE_SA_KEY|secrets\.CLOUD_RUN_SERVICE_NAME/,
    )
    expect(s).not.toMatch(/https?:\/\/[a-z.-]*lifekeel\.(co\.uk|si)/)
  })

  it('updates the image only: it cannot change settings or secrets, or replace staging config', () => {
    const s = src()
    expect(s).toMatch(/gcloud run deploy "\$STAGING_SERVICE" --image "\$IMAGE_REF"/)
    for (const flag of [
      '--set-env-vars',
      '--update-env-vars',
      '--set-secrets',
      '--update-secrets',
      '--remove-secrets',
      'secrets_update_strategy',
      'deploy-cloudrun',
    ])
      expect(s, flag).not.toContain(flag)
  })

  it('publishes one Firebase site, staging, and nothing else', () => {
    const s = src()
    expect(s).toMatch(/firebase deploy --only hosting:staging /)
    expect(s).not.toMatch(/hosting:family|hosting:landing|--only hosting "/)
  })

  it('refuses to build the staging web against a production API, or without an API URL', () => {
    const s = src()
    expect(s).toMatch(/lifekeel\\\.\(co\\\.uk\|si\)/)
    expect(s).toMatch(/STAGING_API_URL/)
    expect(s).toMatch(/must be set/)
  })

  it('builds the staging web against the API directly, not through a rewrite the staging site lacks', () => {
    expect(src()).toMatch(/NEXT_PUBLIC_SAME_ORIGIN_API:\s*''/)
  })

  it('puts the new revision on traffic and checks it before it calls the deploy a success', () => {
    const s = src()
    expect(s).toMatch(/update-traffic "\$STAGING_SERVICE" .*--to-latest/)
    expect(s).toMatch(/\/health\/ready/)
  })

  it('pins its actions to commit SHAs, like the production workflows', () => {
    for (const m of src().matchAll(/uses:\s*([^\s@]+)@([^\s#]+)/g)) {
      if (m[1]!.startsWith('./')) continue
      expect(m[2], m[1]).toMatch(/^[0-9a-f]{40}$/)
    }
  })
})
