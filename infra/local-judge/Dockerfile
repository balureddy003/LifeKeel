# Self-hosted judge model: Ollama + a small open-source model, CPU only.
# The model is baked into the image so cold starts don't download ~5GB.
#
# NOT build-tested in CI yet. Build and smoke-test once before first deploy.
# Base image is digest-pinned (ai-bom.yaml, local-judge-base-image).
FROM ollama/ollama:0.35.0@sha256:2a6e883b917fc543389599dae79918f5cac9e1438890506982f44aa4f5625d01

# MODEL_DIGEST is the sha256 of the registry manifest for MODEL — the pull is
# verified against it below so a re-tagged or swapped model fails the build
# instead of silently shipping a different artifact (ai-bom.yaml,
# local-judge-model).
ARG MODEL=qwen2.5:7b
ARG MODEL_DIGEST=845dbda0ea48ed749caafd9e6037047aa19acfcfd82e704d7ca97d631a0b697e
ENV OLLAMA_MODELS=/models \
    OLLAMA_HOST=0.0.0.0:11434 \
    OLLAMA_KEEP_ALIVE=-1

# Start a temporary server, pull the model into /models, stop it. Written to FAIL the build if the server
# never starts or the pull fails: an earlier version ended in `|| true` and would have produced an image
# with no model in it.
RUN set -eu; \
    ollama serve & pid=$!; \
    ready=0; \
    for i in $(seq 1 60); do if ollama list >/dev/null 2>&1; then ready=1; break; fi; sleep 1; done; \
    [ "$ready" = 1 ] || { echo "ollama did not start" >&2; exit 1; }; \
    ollama pull "$MODEL"; \
    kill "$pid"; wait "$pid" || true; \
    manifest="/models/manifests/registry.ollama.ai/library/${MODEL%:*}/${MODEL##*:}"; \
    actual="$(sha256sum "$manifest" | cut -d' ' -f1)"; \
    [ "$actual" = "$MODEL_DIGEST" ] \
      || { echo "model manifest digest mismatch: got $actual, want $MODEL_DIGEST" >&2; exit 1; }

EXPOSE 11434
