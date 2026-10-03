# Self-hosted judge model: Ollama + a small open-source model, CPU only.
# The model is baked into the image so cold starts don't download ~5GB.
#
# NOT build-tested in CI yet. Build and smoke-test once before first deploy.
FROM ollama/ollama:0.35.0

ARG MODEL=qwen2.5:7b
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
    kill "$pid"; wait "$pid" || true

EXPOSE 11434
