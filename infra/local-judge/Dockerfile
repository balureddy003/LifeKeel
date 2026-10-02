# Self-hosted judge model: Ollama + a small open-source model, CPU only.
# The model is baked into the image so cold starts don't download ~5GB.
#
# NOT build-tested in CI yet. Build and smoke-test once before first deploy.
FROM ollama/ollama:0.35.0

ARG MODEL=qwen2.5:7b
ENV OLLAMA_MODELS=/models \
    OLLAMA_HOST=0.0.0.0:11434 \
    OLLAMA_KEEP_ALIVE=-1

RUN ollama serve & pid=$! \
 && for i in $(seq 1 60); do ollama list >/dev/null 2>&1 && break; sleep 1; done \
 && ollama pull "$MODEL" \
 && kill $pid && wait $pid || true

EXPOSE 11434
