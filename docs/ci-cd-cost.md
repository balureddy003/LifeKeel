# CI/CD on free limits

The repository is **private**, so GitHub Actions runs on the monthly free allowance instead of being
unlimited. As recalled from GitHub's pricing (verify for your plan): the Free plan includes about 2,000
Linux minutes a month, 500 MB of artifact and package storage, and a 10 GB cache; overage is billed
per minute. Measured on this repo's last runs: the main CI job ~7.7 min, `api-image` ~5.5 min,
`local-judge-image` ~7.7 min, `encoder-image` ~2 min.

Before these changes a single push could trigger roughly 23 minutes, a weekly schedule rebuilt all three
images, and a stream of weekly Dependabot PRs each triggered a full run. That is a few days' allowance.

## What changed

| Change | Where | Effect |
|---|---|---|
| Change detection (`scripts/ci-changed.sh`) | `ci.yml`, `images.yml` | Docs-only changes skip build, tests and images. A skipped job reports as passing, so branch protection is not blocked. Unknown or unfetchable base => runs everything (fail-safe). |
| Per-image builds | `images.yml` | Each image builds only when its own inputs changed. |
| Images: weekly -> monthly schedule | `images.yml` | ~4x fewer scheduled minutes. Manual run still available. |
| Turbo cache | `ci.yml` (`.turbo`), `turbo.json` | Unchanged packages replay typecheck/lint/build. `test` is deliberately uncached because it needs live Mongo/Redis. |
| Timeouts | all CI jobs | A hung job can no longer burn minutes. |
| No build-record artifacts | image and deploy workflows | Docker uploads a build record artifact by default; it counts against the 500 MB and nobody reads it. |
| No layer cache for the model image | `deploy-local-judge.yml` | Multi-GB layers would fill the shared 10 GB cache and evict useful ones; the base re-pulls in under a minute. |
| Dependabot monthly and grouped | `.github/dependabot.yml` | A few PRs a month instead of a stream. Security updates still arrive immediately. |
| Deploys stay manual | `deploy-*.yml` | Already `workflow_dispatch`; no automatic spend on merge. |

## Not measured

Expected savings have not been measured; the first month of Actions usage (Settings > Billing) is the
real test. Watch it, and raise the cache or timeouts only with data.

## Other free-tier habits

- Use the GitHub-hosted `ubuntu-latest` runner only (1x multiplier); avoid larger or macOS runners.
- Make the repository public later only if you are comfortable open-sourcing it (public repos get
  unlimited standard minutes), otherwise stay inside the allowance above.
- Deploy only when needed; an image deploy pushes a multi-GB model image only when its inputs changed.
- Google Cloud side: Artifact Registry cleanup keeps storage near the free tier (`infra/gcp`).
