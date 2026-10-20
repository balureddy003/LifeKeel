# Policy-relevance encoder service, CPU only. The model is baked in so cold starts do not download it.
# NOT build-tested (no Docker daemon in the dev environment): build and smoke-test before first deploy.
# Base image is digest-pinned (ai-bom.yaml, encoder-base-image).
FROM python:3.11-slim@sha256:e88e9763f943ec1834f992a4b51e0f24500486803e8bc534e5767af9ea65f6ce

# BAKE_MODEL=false skips the ~1.7 GB model download (CI uses it to check the build and dependencies only).
ARG BAKE_MODEL=true
# ENCODER_MODEL_REVISION pins the exact HF commit — `main` is mutable and
# would let the registry silently swap the artifact (ai-bom.yaml,
# encoder-model).
ENV HF_HOME=/models \
    PYTHONUNBUFFERED=1 \
    ENCODER_MODEL=fastino/GLiNER2.5-Decide \
    ENCODER_MODEL_REVISION=9d1bfb848cd16d93ee56ccbc59cd92bf0f284d90

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

# gliner2 does not declare all of its dependencies: importing it fails at build time if one is missing,
# instead of at the first request in production.
RUN python -c "import warnings; warnings.filterwarnings('ignore'); from gliner2 import GLiNER2"

# Bake the pinned model revision into the image.
RUN if [ "$BAKE_MODEL" = "true" ]; then python -c "import os, warnings; warnings.filterwarnings('ignore'); from gliner2 import GLiNER2; GLiNER2.from_pretrained(os.environ['ENCODER_MODEL'], revision=os.environ['ENCODER_MODEL_REVISION'])"; fi

COPY server.py .
# Cloud Run sets PORT; the service must run with --concurrency=1 (inference is serialised anyway).
CMD ["python", "server.py"]
