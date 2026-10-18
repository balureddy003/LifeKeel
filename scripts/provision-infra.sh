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
#   github     set repo Actions variables; upload SA keys as secrets
#   status     dig/curl every host we just wired up
#
# Run everything:   ./scripts/provision-infra.sh all
# Re-run a piece:   ./scripts/provision-infra.sh dns
#
# Auth expected BEFORE running:
#   gcloud auth login                       (account owning the GCP project)
#   gcloud auth application-default login \
#     --scopes=https://www.googleapis.com/auth/siteverification,https://www.googleapis.com/auth/cloud-platform
#   gh auth login                           (repo admin, for the github step)
#   HOSTINGER_API_TOKEN=...                 (hPanel → API → create token)
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

# Firebase site-id must be [a-z0-9-]: derive a per-domain landing site name.
landing_site() { echo "${APP_SITE}-landing-$(echo "$1" | tr '.-' '--' | tr '.' '-')"; }

fb_api() { # method path [body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sf -X "$method" -H "Authorization: Bearer $(gtoken)" -H 'Content-Type: application/json' -d "$body" "$FB_API/$path"
  else
    curl -sf -X "$method" -H "Authorization: Bearer $(gtoken)" "$FB_API/$path"
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

  echo "SA keys written to $OUT_DIR/ — upload via the 'github' step, then delete."
}

# ---------------------------------------------------------------------------
# Names must match deploy-api.yml's `secrets:` block.
SECRET_NAMES="lifekeel-mongodb-url lifekeel-redis-url lifekeel-jwt-secret
lifekeel-settings-encryption-key lifekeel-google-client-id lifekeel-google-client-secret
lifekeel-stripe-secret-key lifekeel-stripe-webhook-secret lifekeel-openai-api-key
lifekeel-vapid-public-key lifekeel-vapid-private-key lifekeel-vapid-subject"

step_secrets() {
  say "Secret Manager"
  for name in $SECRET_NAMES; do
    gcloud secrets describe "$name" --project "$GCP_PROJECT" >/dev/null 2>&1 \
      || gcloud secrets create "$name" --replication-policy=automatic --project "$GCP_PROJECT"
    # Value comes from a matching env var: lifekeel-jwt-secret -> JWT_SECRET...
    # env name = secret name minus 'lifekeel-' prefix, dashes->underscores, upper.
    local env_name; env_name=$(echo "${name#lifekeel-}" | tr 'a-z-' 'A-Z_')
    local val="${!env_name:-}"
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
    .domainName as $d | .records[]? |
    [$d, .type, .rrdata] | @tsv' | while IFS=$'\t' read -r name type data; do
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
  for d in $APEX_DOMAINS; do
    local tok; tok=$(curl -sf -X POST \
      -H "Authorization: Bearer $(gtoken)" -H 'Content-Type: application/json' \
      "https://www.googleapis.com/siteverification/v1/token" \
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
      -H "Authorization: Bearer $(gtoken)" -H 'Content-Type: application/json' \
      "https://www.googleapis.com/siteverification/v1/webResource?verificationMethod=DNS_TXT" \
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
        gcloud beta run domain-mappings create \
          --service "$RUN_SERVICE" --domain "$sub.$d" \
          --region "$GCP_REGION" --project "$GCP_PROJECT" 2>&1 | tail -3 \
          || warn "$sub.$d mapping failed — service deployed? domain verified?"
      fi
      plan_add "$d" "$sub" "CNAME" "ghs.googlehosted.com"
    done
  done
}

# ---------------------------------------------------------------------------
push_dns() { # domain — reads $OUT_DIR/dns-<domain>.json, PUTs to Hostinger.
  local d="$1" f="$OUT_DIR/dns-$1.json"
  [ -n "${HOSTINGER_API_TOKEN:-}" ] || { warn "HOSTINGER_API_TOKEN unset — skipping $d"; return 1; }
  [ -f "$f" ] || { warn "no plan file $f"; return 1; }
  local zone; zone=$(jq '[.[] | {name, type, ttl, records: [{content}]}]' "$f")
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
        live=$(dig +short "$fqdn" "$type" | tr -d '"' | tr '\n' ' ' | sed 's/ $//')
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
        | jq -r '[.status, .updateState, .certState] | map(select(. != null)) | .[0] // "unknown"')
      printf '  cert %-24s %s\n' "$h" "${st:-unknown}"
    done
  done
}

# ---------------------------------------------------------------------------
[ $# -ge 1 ] || { sed -n '2,30p' "$0"; exit 1; }
need gcloud; need jq; need curl; need dig

for step in "$@"; do
  case "$step" in
    all)      step_gcp; step_secrets; step_firebase; step_verify; step_run_map; step_dns; step_github; step_status ;;
    gcp)      step_gcp ;;
    secrets)  step_secrets ;;
    firebase) step_firebase ;;
    verify)   step_verify ;;
    run-map)  step_run_map ;;
    dns)      step_dns ;;
    github)   step_github ;;
    status)   step_status ;;
    *) echo "unknown step: $step" >&2; exit 1 ;;
  esac
done
