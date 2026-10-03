# Policy-relevance encoder service, CPU only. The model is baked in so cold starts do not download it.
# NOT build-tested (no Docker daemon in the dev environment): build and smoke-test before first deploy.
FROM python:3.11-slim

# BAKE_MODEL=false skips the ~1.7 GB model download (CI uses it to check the build and dependencies only).
ARG BAKE_MODEL=true
ENV HF_HOME=/models \
    PYTHONUNBUFFERED=1 \
    ENCODER_MODEL=fastino/GLiNER2.5-Decide

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

# gliner2 does not declare all of its dependencies: importing it fails at build time if one is missing,
# instead of at the first request in production.
RUN python -c "import warnings; warnings.filterwarnings('ignore'); from gliner2 import GLiNER2"

# Bake the model into the image.
RUN if [ "$BAKE_MODEL" = "true" ]; then python -c "import warnings; warnings.filterwarnings('ignore'); from gliner2 import GLiNER2; GLiNER2.from_pretrained('${ENCODER_MODEL}')"; fi

COPY server.py .
# Cloud Run sets PORT; the service must run with --concurrency=1 (inference is serialised anyway).
CMD ["python", "server.py"]
