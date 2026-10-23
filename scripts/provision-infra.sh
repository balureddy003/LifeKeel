#!/usr/bin/env bash
#
# provision-infra.sh — provision LifeKeel's deploy infrastructure end-to-end.
#
# Covers everything the deploy workflows can't do themselves:
#   gcp        enable APIs, Artifact Registry repo, deploy + runtime service
#              accounts, IAM bindings, write SA keys to deploy-out/
#   secrets    create the Secret Manager secrets deploy-api.yml references
#   firebase   create hosting sites + attach custom domains, capture the DNS
#              records each domain needs into deploy-out/dns-<domain>.json
#   verify     Google site-verification (DNS_TXT) — prerequisite for the
#              Cloud Run domain mappings; pushes the TXT via Hostinger itself
#   run-map    Cloud Run domain mappings for api.<domain>
#   dns        push the collected records to Hostinger (surgical overwrite —
#              only the names/types we own are replaced; MX etc. untouched)
#   resend     create the Resend sender domain (open/click tracking on),
#              write its DKIM/SPF/tracking records into the Hostinger DNS
#              plan, create the email event webhook -> api.<domain>
#              /webhooks/resend, and store RESEND_API_KEY +
#              RESEND_WEBHOOK_SECRET in Secret Manager + .env
#   github     set repo Actions variables; upload SA keys as secrets
#   stripe     make Stripe match definitions/stripe-config.yaml (product, price,
#              webhook endpoint, Customer Portal) — dry-run unless STRIPE_APPLY=1.
#              Not part of `all`: it needs a Stripe key. See docs/runbooks/stripe-setup.md
#   operator   seed platform_operators super_admin docs in the prod MongoDB
#              (needs PLATFORM_OPERATOR_USER_IDS — LifeKeel user ids from
#              users.id / GET /auth/me, comma-separated; NOT emails)
#   status     dig/curl every host we just wired up
#
# Run everything:   ./scripts/provision-infra.sh all
# Re-run a piece:   ./scripts/provision-infra.sh dns
#
# Auth — everything is a plain terminal command, no API keys to mint:
#   gcloud auth login                       (account owning the GCP project)
#   gcloud auth application-default login \
#     --scopes=https://www.googleapis.com/auth/siteverification,https://www.googleapis.com/auth/cloud-platform
#     (only needed for the 'verify' step — skip it and verify domains in
#      Search Console manually if you'd rather not grant the scope)
#   gh auth login                           (repo admin, for the github step)
#   brew install hostinger/tap/hostinger    (first command opens browser sign-in)
#     — or set HOSTINGER_API_TOKEN from hPanel -> API as the fallback.
#
# Config (all overridable via env — defaults are this repo's prod values):
#   GCP_PROJECT=dyocense-502208   GCP_REGION=us-central1
#   AR_REPO=lifekeel-docker       RUN_SERVICE=lifekeel-api
#   APP_SITE=lifekeel             GH_REPO=balureddy003/LifeKeel
#   APEX_DOMAINS="lifekeel.co.uk lifekeel.si"
#   PRIMARY_DOMAIN=lifekeel.co.uk

set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:-dyocense-502208}"
GCP_REGION="${GCP_REGION:-us-central1}"
AR_REPO="${AR_REPO:-lifekeel-docker}"
RUN_SERVICE="${RUN_SERVICE:-lifekeel-api}"
APP_SITE="${APP_SITE:-lifekeel}"
GH_REPO="${GH_REPO:-balureddy003/LifeKeel}"
APEX_DOMAINS="${APEX_DOMAINS:-lifekeel.co.uk lifekeel.si}"
PRIMARY_DOMAIN="${PRIMARY_DOMAIN:-lifekeel.co.uk}"
# Space-separated subdomains that map to the Cloud Run service (api by
# default; extend e.g. RUN_SUBDOMAINS="api hooks" for a webhooks host).
RUN_SUBDOMAINS="${RUN_SUBDOMAINS:-api}"
OUT_DIR="${OUT_DIR:-deploy-out}"
FB_API="https://firebasehosting.googleapis.com/v1beta1"
HOSTINGER_API="https://developers.hostinger.com"

mkdir -p "$OUT_DIR"

say()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "missing tool: $1" >&2; exit 1; }; }
warn() { echo "  ! $*"; }

gtoken() { gcloud auth print-access-token 2>/dev/null || gcloud auth application-default print-access-token; }

# Landing site name = APP_SITE-landing-<tld> (matches .firebaserc targets).
landing_site() { echo "${APP_SITE}-landing-$(echo "$1" | awk -F. '{print $NF}')"; }

fb_api() { # method path [body]
  # X-Goog-User-Project: user creds need a quota project header for the
  # Firebase Hosting API — without it calls 403 with SERVICE_DISABLED.
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sf -X "$method" -H "Authorization: Bearer $(gtoken)" \
      -H "X-Goog-User-Project: $GCP_PROJECT" -H 'Content-Type: application/json' \
      -d "$body" "$FB_API/$path"
  else
    curl -sf -X "$method" -H "Authorization: Bearer $(gtoken)" \
      -H "X-Goog-User-Project: $GCP_PROJECT" "$FB_API/$path"
  fi
}

# Append a record to a domain's DNS plan file (JSON array of {name,type,content,ttl}).
plan_add() { # domain name type content
  local f="$OUT_DIR/dns-$1.json"
  [ -f "$f" ] || echo '[]' > "$f"
  jq --arg n "$2" --arg t "$3" --arg c "$4" \
    '. + [{name:$n, type:$t, content:$c, ttl:300}] | unique_by({name,type,content})' \
    "$f" > "$f.tmp" && mv "$f.tmp" "$f"
}

# ---------------------------------------------------------------------------
step_gcp() {
  say "GCP: APIs, Artifact Registry, service accounts"
  gcloud config set project "$GCP_PROJECT" >/dev/null

  gcloud services enable \
    run.googleapis.com artifactregistry.googleapis.com \
    secretmanager.googleapis.com firebasehosting.googleapis.com \
    firebase.googleapis.com iam.googleapis.com \
    aiplatform.googleapis.com \
    siteverification.googleapis.com --project "$GCP_PROJECT"

  if ! gcloud artifacts repositories describe "$AR_REPO" --location "$GCP_REGION" >/dev/null 2>&1; then
    gcloud artifacts repositories create "$AR_REPO" \
      --repository-format=docker --location "$GCP_REGION" \
      --description "LifeKeel images"
  fi

  # Deploy SA — what GitHub Actions authenticates as for deploy-api.yml.
  local deploy_sa="github-deploy@${GCP_PROJECT}.iam.gserviceaccount.com"
  gcloud iam service-accounts describe "$deploy_sa" >/dev/null 2>&1 \
    || gcloud iam service-accounts create github-deploy --display-name "GitHub Actions deploy"
  for role in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser roles/storage.admin; do
    gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
      --member "serviceAccount:$deploy_sa" --role "$role" >/dev/null
  done
  if [ -f "$OUT_DIR/gcp-sa-key.json" ]; then
    warn "gcp-sa-key.json already exists — skipping (delete it first to rotate the key)"
  else
    gcloud iam service-accounts keys create "$OUT_DIR/gcp-sa-key.json" \
      --iam-account "$deploy_sa" || warn "key creation blocked by org policy — create one in console"
  fi

  # Firebase deploy SA — what deploy-web.yml authenticates as.
  local fb_sa="github-firebase@${GCP_PROJECT}.iam.gserviceaccount.com"
  gcloud iam service-accounts describe "$fb_sa" >/dev/null 2>&1 \
    || gcloud iam service-accounts create github-firebase --display-name "GitHub Actions Firebase deploy"
  gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
    --member "serviceAccount:$fb_sa" --role roles/firebasehosting.admin >/dev/null
  # Hosting rewrites to Cloud Run are validated at deploy time — the SA must
  # be able to read the service or `firebase deploy` fails with 403.
  gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
    --member "serviceAccount:$fb_sa" --role roles/run.viewer >/dev/null
  if [ -f "$OUT_DIR/firebase-sa-key.json" ]; then
    warn "firebase-sa-key.json already exists — skipping (delete it first to rotate the key)"
  else
    gcloud iam service-accounts keys create "$OUT_DIR/firebase-sa-key.json" \
      --iam-account "$fb_sa" || warn "key creation blocked by org policy — create one in console"
  fi

  # Cloud Run runs as the default compute SA (deploy-api.yml sets no
  # --service-account). It needs read access to the secrets bound as env vars.
  local num; num=$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)')
  gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
    --member "serviceAccount:${num}-compute@developer.gserviceaccount.com" \
    --role roles/secretmanager.secretAccessor >/dev/null
  # Vertex AI Gemini — the API's identity calls aiplatform via ADC, no key.
  gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
    --member "serviceAccount:${num}-compute@developer.gserviceaccount.com" \
    --role roles/aiplatform.user >/dev/null

  echo "SA keys written to $OUT_DIR/ — upload via the 'github' step, then delete."
}

# ---------------------------------------------------------------------------
# Names must match deploy-api.yml's `secrets:` block.
SECRET_NAMES="lifekeel-mongodb-url lifekeel-redis-url lifekeel-jwt-secret
lifekeel-settings-encryption-key lifekeel-google-client-id lifekeel-google-client-secret
lifekeel-stripe-secret-key lifekeel-stripe-webhook-secret lifekeel-openai-api-key
lifekeel-vapid-public-key lifekeel-vapid-private-key lifekeel-vapid-subject
lifekeel-resend-api-key lifekeel-resend-webhook-secret"

step_secrets() {
  say "Secret Manager"
  for name in $SECRET_NAMES; do
    gcloud secrets describe "$name" --project "$GCP_PROJECT" >/dev/null 2>&1 \
      || gcloud secrets create "$name" --replication-policy=automatic --project "$GCP_PROJECT"
    # Value comes from a matching env var: lifekeel-jwt-secret -> JWT_SECRET...
    # env name = secret name minus 'lifekeel-' prefix, dashes->underscores, upper.
    local env_name; env_name=$(echo "${name#lifekeel-}" | tr 'a-z-' 'A-Z_')
    local val="${!env_name:-}"
    # Fallback: read .env directly — sourcing it breaks on values containing
    # unquoted shell metacharacters (& in mongodb+srv query strings, etc.).
    if [ -z "$val" ] && [ -f .env ]; then
      val=$(grep -E "^${env_name}=" .env | tail -1 | cut -d= -f2- \
        | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//")
    fi
    if [ -n "$val" ]; then
      printf '%s' "$val" | gcloud secrets versions add "$name" --data-file=- --project "$GCP_PROJECT" >/dev/null
      echo "  $name <- \$$env_name"
    else
      warn "$name exists but has no value — set \$$env_name and re-run, or add a version in console"
    fi
  done
}

# ---------------------------------------------------------------------------
step_firebase() {
  say "Firebase: hosting sites + custom domains"
  # The app site itself may not exist yet (.firebaserc only records the
  # target mapping; it doesn't create the site).
  fb_api GET "projects/$GCP_PROJECT/sites/$APP_SITE" >/dev/null 2>&1 \
    || fb_api POST "projects/$GCP_PROJECT/sites?siteId=$APP_SITE" '{}' >/dev/null
  echo "  site: $APP_SITE"
  for d in $APEX_DOMAINS; do
    local site; site=$(landing_site "$d")
    fb_api GET "projects/$GCP_PROJECT/sites/$site" >/dev/null 2>&1 \
      || fb_api POST "projects/$GCP_PROJECT/sites?siteId=$site" '{}' >/dev/null
    echo "  site: $site"
    # apex + www live on the landing site; app.* on the app site.
    for host in "$d" "www.$d"; do attach_domain "$site" "$host"; done
    attach_domain "$APP_SITE" "app.$d"
  done
  echo "DNS plans written to $OUT_DIR/dns-*.json — run the 'dns' step to apply them."
}

attach_domain() { # site host
  local site="$1" host="$2"
  local path="projects/$GCP_PROJECT/sites/$site/customDomains/$host"
  if ! fb_api GET "$path" >/dev/null 2>&1; then
    fb_api POST "projects/$GCP_PROJECT/sites/$site/customDomains?customDomainId=$host" '{}' \
      >/dev/null 2>&1 || warn "customDomains create failed for $host (may already exist or need console setup)"
    sleep 2
  fi
  local resp; resp=$(fb_api GET "$path" 2>/dev/null || echo '{}')
  # requiredDnsUpdates.desired[].records[] is authoritative — includes any
  # ownership-verification TXT Firebase wants before it provisions the cert.
  echo "$resp" | jq -r '
    .requiredDnsUpdates.desired[]? |
    .domainName as $d |
    (.records[]? | select(.requiredAction == "ADD") | [$d, .type, .rdata] | @tsv)' \
    | while IFS=$'\t' read -r name type data; do
      # Strip the domain suffix -> record name relative to zone apex.
      for apex_d in $APEX_DOMAINS; do
        if [ "$name" = "$apex_d" ]; then plan_add "$apex_d" "@" "$type" "$data"; break; fi
        if [[ "$name" == *".$apex_d" ]]; then
          plan_add "$apex_d" "${name%.$apex_d}" "$type" "$data"; break
        fi
      done
    done
  echo "  domain: $host -> $site"
}

# ---------------------------------------------------------------------------
step_verify() {
  say "Google site-verification (DNS_TXT) — required before Cloud Run mappings"
  # Needs the ADC token (siteverification scope), not the gcloud login token,
  # plus the quota-project header ADC credentials require.
  local tok_adc; tok_adc=$(gcloud auth application-default print-access-token 2>/dev/null) \
    || { warn "run: gcloud auth application-default login --scopes=siteverification,cloud-platform"; return 1; }
  for d in $APEX_DOMAINS; do
    local tok; tok=$(curl -sf -X POST \
      -H "Authorization: Bearer $tok_adc" -H "X-Goog-User-Project: $GCP_PROJECT" \
      -H 'Content-Type: application/json' \
      "https://www.googleapis.com/siteVerification/v1/token" \
      -d "{\"site\":{\"type\":\"INET_DOMAIN\",\"identifier\":\"$d\"},\"verificationMethod\":\"DNS_TXT\"}" \
      | jq -r '.token // empty')
    if [ -z "$tok" ]; then
      warn "couldn't get verification token for $d — ADC needs scope siteverification"
      warn "fallback: verify $d at https://www.google.com/webmasters/verification then re-run"
      continue
    fi
    plan_add "$d" "@" "TXT" "$tok"
    HOSTINGER_API_TOKEN="${HOSTINGER_API_TOKEN:-}" push_dns "$d" || warn "push TXT for $d manually: @ TXT $tok"
    curl -sf -X POST \
      -H "Authorization: Bearer $tok_adc" -H "X-Goog-User-Project: $GCP_PROJECT" \
      -H 'Content-Type: application/json' \
      "https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=DNS_TXT" \
      -d "{\"site\":{\"type\":\"INET_DOMAIN\",\"identifier\":\"$d\"}}" >/dev/null \
      && echo "  verified: $d" || warn "$d verification pending (DNS propagation)"
  done
}

# ---------------------------------------------------------------------------
step_run_map() {
  say "Cloud Run domain mappings (${RUN_SUBDOMAINS// /,}.<domain>)"
  for d in $APEX_DOMAINS; do
    for sub in $RUN_SUBDOMAINS; do
      if gcloud beta run domain-mappings describe --domain "$sub.$d" \
           --region "$GCP_REGION" --project "$GCP_PROJECT" >/dev/null 2>&1; then
        echo "  mapping exists: $sub.$d"
      else
        gcloud beta run domain-mappings create --quiet \
          --service "$RUN_SERVICE" --domain "$sub.$d" \
          --region "$GCP_REGION" --project "$GCP_PROJECT" 2>&1 | tail -3 \
          || warn "$sub.$d mapping failed — service deployed? domain verified?"
      fi
      plan_add "$d" "$sub" "CNAME" "ghs.googlehosted.com"
    done
  done
}

# ---------------------------------------------------------------------------
push_dns() { # domain — reads $OUT_DIR/dns-<domain>.json, applies to Hostinger.
  local d="$1" f="$OUT_DIR/dns-$1.json"
  [ -f "$f" ] || { warn "no plan file $f"; return 1; }

  # Merge plan records with whatever already lives at each (name, type) —
  # overwrite=true replaces the whole set for a name+type, so we must carry
  # existing contents forward (e.g. the SPF TXT for Hostinger mail).
  local existing zone
  if command -v hostinger >/dev/null; then
    existing=$(hostinger dns records list "$d" --format json 2>/dev/null || echo '[]')
  elif [ -n "${HOSTINGER_API_TOKEN:-}" ]; then
    existing=$(curl -sf "$HOSTINGER_API/api/dns/v1/zones/$d" \
      -H "Authorization: Bearer $HOSTINGER_API_TOKEN" 2>/dev/null || echo '[]')
  else
    existing='[]'
  fi
  zone=$(jq -n --argjson plan "$(cat "$f")" --argjson live "$existing" '
    def strip: gsub("^\"|\"$"; "");   # live TXT contents come back quoted
    ($plan | group_by(.name + "|" + .type)) as $groups |
    [ $groups[] as $g |
      ($g[0] | {name, type, ttl}) +
      {records: (if ($g[0].type | IN("TXT", "MX", "SRV", "NS"))
                 # multi-value types: union live + plan so nothing is lost
                 then ([ $live[]? | select(.name == $g[0].name and .type == $g[0].type)
                         | .records[]?.content | strip ] + [$g[] | .content] | unique)
                 # single-value types: plan wins — stale IPs/CNAMEs must go
                 else [$g[] | .content]
                 end | map({content: .}))} ]' )

  # Preferred auth: the hostinger CLI (browser sign-in, no API token needed).
  if command -v hostinger >/dev/null; then
    hostinger dns records validate "$d" --zone "$zone" >/dev/null 2>&1 \
      || warn "Hostinger validation failed for $d — check the plan file"
    hostinger dns records update "$d" --overwrite=true --zone "$zone" >/dev/null \
      && echo "  dns: $d updated" || warn "Hostinger update failed for $d"
    return
  fi

  # Fallback: REST API with a token from hPanel -> API.
  [ -n "${HOSTINGER_API_TOKEN:-}" ] || {
    warn "no Hostinger auth — brew install hostinger/tap/hostinger (browser sign-in),"
    warn "or export HOSTINGER_API_TOKEN from hPanel -> API. Skipping $d"
    return 1
  }
  curl -sf -X POST "$HOSTINGER_API/api/dns/v1/zones/$d/validate" \
    -H "Authorization: Bearer $HOSTINGER_API_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"overwrite\":true,\"zone\":$zone}" >/dev/null \
    || warn "Hostinger validation failed for $d — check the plan file"
  curl -sf -X PUT "$HOSTINGER_API/api/dns/v1/zones/$d" \
    -H "Authorization: Bearer $HOSTINGER_API_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"overwrite\":true,\"zone\":$zone}" >/dev/null \
    && echo "  dns: $d updated" || warn "Hostinger update failed for $d"
}

step_dns() {
  say "Hostinger DNS (overwrite=true only replaces names/types we send — MX stays)"
  for d in $APEX_DOMAINS; do push_dns "$d"; done
  warn "disable Hostinger CDN/proxying on each domain in hPanel if it's on —"
  warn "it terminates TLS itself and breaks Firebase/Google cert provisioning"
}

# ---------------------------------------------------------------------------
step_github() {
  say "GitHub Actions variables + secrets on $GH_REPO"
  local cors=""; for d in $APEX_DOMAINS; do cors="${cors:+$cors,}https://app.$d"; done

  gh variable set FIREBASE_PROJECT_ID --body "$GCP_PROJECT"          --repo "$GH_REPO"
  gh variable set GCP_REGION          --body "$GCP_REGION"           --repo "$GH_REPO"
  gh variable set LIFEKEEL_URL        --body "https://app.$PRIMARY_DOMAIN" --repo "$GH_REPO"
  gh variable set API_BASE_URL        --body "https://api.$PRIMARY_DOMAIN" --repo "$GH_REPO"
  gh variable set NEXT_PUBLIC_API_URL --body "https://api.$PRIMARY_DOMAIN" --repo "$GH_REPO"
  gh variable set CORS_ORIGIN         --body "$cors"                 --repo "$GH_REPO"
  gh variable set EMAIL_FROM          --body "${EMAIL_FROM:-accounts@mail.$PRIMARY_DOMAIN}" --repo "$GH_REPO"

  gh secret set GCP_PROJECT_ID --body "$GCP_PROJECT" --repo "$GH_REPO"
  [ -f "$OUT_DIR/gcp-sa-key.json" ] \
    && gh secret set GCP_SA_KEY --repo "$GH_REPO" < "$OUT_DIR/gcp-sa-key.json" \
    || warn "gcp-sa-key.json missing — run 'gcp' step first"
  [ -f "$OUT_DIR/firebase-sa-key.json" ] \
    && gh secret set FIREBASE_SA_KEY --repo "$GH_REPO" < "$OUT_DIR/firebase-sa-key.json" \
    || warn "firebase-sa-key.json missing — run 'gcp' step first"
  warn "SA keys now in $OUT_DIR/ — delete the directory once secrets are confirmed"
}

# ---------------------------------------------------------------------------
# stripe — billing setup as code. Dry-run by default.
#   STRIPE_RECONCILE_KEY   restricted key (rk_...); falls back to the
#                          lifekeel-stripe-secret-key secret in Secret Manager
#   STRIPE_APPLY=1         actually make the changes (default: print the diff)
#   STRIPE_ALLOW_LIVE=1    required to apply against a LIVE key
# When the run creates the webhook endpoint, Stripe returns its signing secret
# exactly once. It goes straight from a 0600 temp file into Secret Manager
# (lifekeel-stripe-webhook-secret) and is never printed or kept.
step_stripe() {
  say "Stripe (config as code)"
  need pnpm
  local key="${STRIPE_RECONCILE_KEY:-}"
  if [ -z "$key" ]; then
    key=$(gcloud secrets versions access latest --secret lifekeel-stripe-secret-key --project "$GCP_PROJECT" 2>/dev/null || true)
    [ -n "$key" ] && echo "  using key from Secret Manager (lifekeel-stripe-secret-key)"
  fi
  [ -n "$key" ] || { warn "no Stripe key: set STRIPE_RECONCILE_KEY (restricted key) and re-run"; return 1; }

  local api_sub; api_sub=$(echo "$RUN_SUBDOMAINS" | awk '{print $1}')
  local args=(--api-origin "https://$api_sub.$PRIMARY_DOMAIN" --app-origin "https://app.$PRIMARY_DOMAIN")
  local secret_file=""
  if [ "${STRIPE_APPLY:-0}" = "1" ]; then
    secret_file=$(mktemp); chmod 600 "$secret_file"
    args+=(--apply --webhook-secret-file "$secret_file")
    [ "${STRIPE_ALLOW_LIVE:-0}" = "1" ] && args+=(--allow-live)
  else
    echo "  dry-run — set STRIPE_APPLY=1 to apply"
  fi

  local rc=0
  STRIPE_RECONCILE_KEY="$key" pnpm --filter @lifekeel/api run stripe:reconcile "${args[@]}" || rc=$?

  if [ -n "$secret_file" ]; then
    if [ -s "$secret_file" ]; then
      gcloud secrets versions add lifekeel-stripe-webhook-secret --data-file="$secret_file" --project "$GCP_PROJECT" >/dev/null
      echo "  webhook signing secret stored in lifekeel-stripe-webhook-secret"
      echo "  -> redeploy the API (Deploy API workflow) so the new revision reads it"
    fi
    rm -f "$secret_file"
  fi
  # Exit 2 = drift found in a dry-run; surface it without failing 'all'-style chains.
  [ "$rc" = "2" ] && { warn "drift found (see above)"; return 0; }
  return "$rc"
}

# ---------------------------------------------------------------------------
# Resend — provider-side setup the deploy can't do: the sender domain's DKIM/
# SPF records (Resend recommends a subdomain — RESEND_DOMAIN defaults to
# mail.<primary>), click/open tracking (required for the webhook's
# email.opened/clicked parity with SendGrid), and the event webhook itself.
# DNS records land in the Hostinger plan (deploy-out/dns-<apex>.json) — the
# `dns` step applies them; verification is idempotent so re-running after
# propagation is the normal flow.
step_resend() {
  say "Resend: sender domain + webhook ($GCP_PROJECT)"

  # API key from env or .env (same unquoted read as step_secrets).
  local key="${RESEND_API_KEY:-}"
  if [ -z "$key" ] && [ -f .env ]; then
    key=$(grep -E '^RESEND_API_KEY=' .env | tail -1 | cut -d= -f2- \
      | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//")
  fi
  [ -n "$key" ] || { warn "RESEND_API_KEY not set — get one at resend.com/api-keys"; return 1; }

  local api="https://api.resend.com"
  local domain="${RESEND_DOMAIN:-mail.$PRIMARY_DOMAIN}"
  local region="${RESEND_REGION:-eu-west-1}"
  local endpoint="https://api.$PRIMARY_DOMAIN/webhooks/resend"
  local events='["email.delivered","email.opened","email.clicked","email.bounced","email.failed","email.complained"]'

  resend_api() { # method path [body]
    local method="$1" path="$2" body="${3:-}"
    if [ -n "$body" ]; then
      curl -sf -X "$method" -H "Authorization: Bearer $key" \
        -H 'Content-Type: application/json' -d "$body" "$api/$path" 2>/dev/null
    else
      curl -sf -X "$method" -H "Authorization: Bearer $key" "$api/$path" 2>/dev/null
    fi
  }

  sm_upsert() { # secret-name value — create if absent, then add a version.
    gcloud secrets describe "$1" --project "$GCP_PROJECT" >/dev/null 2>&1 \
      || gcloud secrets create "$1" --replication-policy=automatic --project "$GCP_PROJECT" >/dev/null
    printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- \
      --project "$GCP_PROJECT" >/dev/null \
      && echo "  secret: $1" || warn "couldn't write $1"
  }

  # Runtime only ever calls POST /emails — a send-only key is the right
  # least-privilege credential to ship. Persist it unconditionally.
  sm_upsert lifekeel-resend-api-key "$key"

  # Managing domains/webhooks needs broader scope than send-only keys have.
  # Probe once: a restricted key 401s on GET /domains — keep the key (it's
  # correct for runtime) and print the dashboard path instead of dying.
  local probe; probe=$(resend_api GET "domains" || true)
  if ! echo "${probe:-{}}" | jq -e '.data != null' >/dev/null 2>&1; then
    warn "RESEND_API_KEY is send-only — it can't manage domains/webhooks, which is"
    warn "fine for runtime (send is all the API does). Finish in the Resend dashboard:"
    warn "  1. Domains → Add Domain → $domain (region $region) → enable open+click"
    warn "     tracking; copy its DKIM/SPF records into the $PRIMARY_DOMAIN DNS zone"
    warn "  2. Webhooks → $endpoint → events: $events"
    warn "  3. Store the whsec_… signing secret in lifekeel-resend-webhook-secret + .env"
    warn "  4. Set EMAIL_FROM (repo variable) to an address on $domain"
    warn "(or re-run 'resend' with a full-access RESEND_API_KEY to automate 1–3)"
    return 0
  fi

  # Create or reuse the domain, then fetch its record set.
  local dom_id dom
  dom=$(resend_api POST "domains" \
    "{\"name\":\"$domain\",\"region\":\"$region\",\"open_tracking\":true,\"click_tracking\":true,\"tracking_subdomain\":\"links\"}" || true)
  dom_id=$(echo "${dom:-{}}" | jq -r '.id // empty')
  if [ -z "$dom_id" ]; then
    dom_id=$(echo "$probe" | jq -r --arg n "$domain" \
      '.data[]? | select(.name == $n) | .id' | head -1)
    [ -n "$dom_id" ] || { warn "couldn't create/find domain $domain in Resend — check the API key"; return 1; }
    echo "  domain exists: $domain ($dom_id)"
  else
    echo "  domain created: $domain ($dom_id)"
  fi
  dom=$(resend_api GET "domains/$dom_id" || echo '{}')

  # Which apex zone owns this sender domain — records go into that plan file.
  local apex=""
  for d in $APEX_DOMAINS; do
    case "$domain" in "$d"|*".$d") apex="$d"; break ;; esac
  done
  if [ -z "$apex" ]; then
    warn "$domain isn't under any APEX_DOMAINS zone — add its DNS records manually:"
    echo "$dom" | jq -r '.records[]? | "  \(.name)\t\(.type)\t\(.value)"'
  else
    # Record names come back either relative to the sender domain
    # (resend._domainkey, send) or FQDN (links.mail.example.com). Normalize
    # to the zone-relative name the Hostinger plan uses; MX content needs
    # "priority host"; TXT values lose their zone-file quoting.
    echo "$dom" | jq -r '.records[]? | [.name, .type, .value, (.priority // "")] | @tsv' \
      | while IFS=$'\t' read -r name type value priority; do
        fqdn=$name; case "$fqdn" in *"$domain") ;; *) fqdn="$fqdn.$domain" ;; esac
        rel=$fqdn;  case "$rel" in   *".$apex") rel="${rel%.$apex}" ;; "$apex") rel="@" ;; esac
        case "$type" in
          MX)  value="${priority:-10} $value" ;;
          TXT) value="${value#\"}"; value="${value%\"}" ;;
        esac
        plan_add "$apex" "$rel" "$type" "$value"
        echo "  dns plan: $rel.$apex $type"
      done
    warn "run the 'dns' step to push these to Hostinger, then re-run 'resend' to verify"
  fi

  # Kick verification (idempotent — safe before and after DNS lands).
  resend_api POST "domains/$dom_id/verify" >/dev/null \
    && echo "  verification requested" || warn "verify call failed — retry after DNS propagates"
  echo "$dom" | jq -r '.records[]? | "  \(.record // "?") \(.status)"' | sort -u | sed 's/^/  status:/'

  # Event webhook → api.<primary>/webhooks/resend. Resend returns the
  # signing_secret on create AND on list/get, so re-running recovers it.
  local wh wh_secret
  wh=$(resend_api GET "webhooks" || true)
  wh_secret=$(echo "${wh:-{}}" | jq -r --arg e "$endpoint" \
    '[.data[]? | select(.endpoint == $e)] | first | .signing_secret // empty')
  if [ -n "$wh_secret" ]; then
    echo "  webhook exists: $endpoint"
  else
    wh=$(resend_api POST "webhooks" "{\"endpoint\":\"$endpoint\",\"events\":$events}" || true)
    wh_secret=$(echo "${wh:-{}}" | jq -r '.signing_secret // empty')
    [ -n "$wh_secret" ] && echo "  webhook created: $endpoint" \
      || warn "webhook create failed — add $endpoint in the Resend dashboard for the events: $events"
  fi

  if [ -n "$wh_secret" ]; then
    sm_upsert lifekeel-resend-webhook-secret "$wh_secret"
    if [ -f .env ] && ! grep -qE '^RESEND_WEBHOOK_SECRET=' .env; then
      sed -i '' -e 's/^# RESEND_WEBHOOK_SECRET=whsec_\.\.\./RESEND_WEBHOOK_SECRET='"$wh_secret"'/' .env 2>/dev/null \
        || echo "RESEND_WEBHOOK_SECRET=$wh_secret" >> .env
      echo "  .env: RESEND_WEBHOOK_SECRET set"
    fi
  fi

  # Sender address must live on the verified domain — operators override
  # via the EMAIL_FROM repo variable (deploy-api.yml env_vars).
  local from="${EMAIL_FROM:-accounts@$domain}"
  warn "EMAIL_FROM should be an address on $domain (suggest: $from)"
}

# ---------------------------------------------------------------------------
# Seeds DB-managed super_admins — the durable operator path (ARCHITECTURE.md
# §14.2). Deliberately NOT PLATFORM_OPERATOR_USER_IDS on Cloud Run: env vars
# set via `gcloud run services update` are wiped by the next deploy (the
# workflow's env_vars block replaces the set), and a standing env super_admin
# is exactly the break-glass backdoor PLATFORM_OPERATOR_BOOTSTRAP_UNTIL
# exists to retire.
step_operator() {
  say "Platform operators → platform_operators ($GCP_PROJECT)"

  local ids="${PLATFORM_OPERATOR_USER_IDS:-}"
  if [ -z "$ids" ] && [ -f .env ]; then
    ids=$(grep -E '^PLATFORM_OPERATOR_USER_IDS=' .env | tail -1 | cut -d= -f2- \
      | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//")
  fi
  if [ -z "$ids" ]; then
    warn "no PLATFORM_OPERATOR_USER_IDS — set it to the PROD user id(s) first"
    warn "(sign in on the deployed app, GET /auth/me → user_id — not the dev id)"
    return 1
  fi

  local db="${MONGODB_DB:-lifekeel}" uri
  uri=$(gcloud secrets versions access latest \
        --secret=lifekeel-mongodb-url --project "$GCP_PROJECT" 2>/dev/null) \
    || { warn "can't read lifekeel-mongodb-url — grant $(gcloud config get-value account 2>/dev/null) roles/secretmanager.secretAccessor"
         return 1; }

  need mongosh
  local uid
  echo "$ids" | tr ',' '\n' | while IFS= read -r uid; do
    uid=$(echo "$uid" | tr -d '[:space:]')
    [ -n "$uid" ] || continue
    # Keep the id out of arbitrary eval — user ids are generated hex; reject
    # anything that couldn't be one rather than quoting around it.
    case "$uid" in *[!a-zA-Z0-9_-]*) warn "skipping '$uid' — not a valid user id"; continue ;; esac
    mongosh "$uri" --quiet --eval "
      db.getSiblingDB('$db').platform_operators.updateOne(
        { user_id: '$uid' },
        { \$setOnInsert: { user_id: '$uid', roles: ['super_admin'], status: 'active' } },
        { upsert: true }
      )" >/dev/null \
      && echo "  super_admin seeded: $uid" \
      || warn "seed failed for $uid — Atlas IP allowlist blocking this machine? (then insert via Atlas console: $db.platform_operators)"
  done
  echo "  done — sign in on the deployed app and open /operator"
}

# ---------------------------------------------------------------------------
step_status() {
  say "Status — live DNS vs plan"
  for d in $APEX_DOMAINS; do
    local f="$OUT_DIR/dns-$d.json"
    for host in "$d" "www.$d" "app.$d" $(for s in $RUN_SUBDOMAINS; do echo "$s.$d"; done); do
      printf '  %-24s -> %s\n' "$host" "$(dig +short "$host" | tr '\n' ' ')"
    done
    # Drift report: every record the plan wants, compared with what's live.
    [ -f "$f" ] || continue
    jq -r '.[] | "\(.name)\t\(.type)\t\(.content)"' "$f" | \
      while IFS=$'\t' read -r name type want; do
        fqdn=$([ "$name" = "@" ] && echo "$d" || echo "$name.$d")
        live=$(dig +short "$fqdn" "$type" | tr -d '"' | sed 's/\.$//' | tr '\n' ' ' | sed 's/ $//')
        want="${want%.}"
        case " $live " in
          *" $want "*) : ;;
          *) printf '  DRIFT %-22s %-6s want=%s live=%s\n' "$fqdn" "$type" "$want" "${live:-<none>}" ;;
        esac
      done
    # Cert provisioning state for each hosting custom domain.
    local site; site=$(landing_site "$d")
    for pair in "$site:$d" "$site:www.$d" "$APP_SITE:app.$d"; do
      IFS=: read -r s h <<< "$pair"
      st=$(fb_api GET "projects/$GCP_PROJECT/sites/$s/customDomains/$h" 2>/dev/null \
        | jq -r '"\(.cert.state // "?")/\(.hostState // "?")/\(.ownershipState // "?")"')
      printf '  cert %-24s %s\n' "$h" "${st:-unknown}"
    done
  done
}

# ---------------------------------------------------------------------------
[ $# -ge 1 ] || { sed -n '2,30p' "$0"; exit 1; }
need gcloud; need jq; need curl; need dig

for step in "$@"; do
  case "$step" in
    all)      step_gcp; step_secrets; step_firebase; step_verify; step_run_map; step_resend; step_dns; step_github; step_status ;;
    gcp)      step_gcp ;;
    secrets)  step_secrets ;;
    firebase) step_firebase ;;
    verify)   step_verify ;;
    run-map)  step_run_map ;;
    resend)   step_resend ;;
    dns)      step_dns ;;
    github)   step_github ;;
    stripe)   step_stripe ;;
    operator) step_operator ;;
    status)   step_status ;;
    *) echo "unknown step: $step" >&2; exit 1 ;;
  esac
done
