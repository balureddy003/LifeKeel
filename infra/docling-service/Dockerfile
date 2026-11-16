# Docling parsing worker (intent 97, slice 3) — SCAFFOLD, not deployed.
# Hosting and the cost ceiling are an open owner decision; this image exists so
# that decision has something concrete to evaluate. NOT build-tested (no Docker
# daemon in the dev environment): build and smoke-test before first deploy.
# Base image is digest-pinned in the same style as infra/encoder-service.
FROM python:3.11-slim@sha256:e88e9763f943ec1834f992a4b51e0f24500486803e8bc534e5767af9ea65f6ce

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    DOCLING_MODEL=docling-project/docling-layout-heron

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Fail the build if the lazy import in server.py cannot resolve.
RUN python -c "import warnings; warnings.filterwarnings('ignore'); import docling"

COPY server.py .
# Cloud Run sets PORT; run with --concurrency=1 (conversion is serialised anyway)
# and --no-allow-unauthenticated so only the API's service account can call it.
CMD ["python", "server.py"]
