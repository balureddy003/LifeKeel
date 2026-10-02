# Policy-relevance encoder service, CPU only. The model is baked in so cold starts do not download it.
# NOT build-tested (no Docker daemon in the dev environment): build and smoke-test before first deploy.
FROM python:3.11-slim

ENV HF_HOME=/models \
    PYTHONUNBUFFERED=1 \
    ENCODER_MODEL=fastino/GLiNER2.5-Decide

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

# Bake the model into the image.
RUN python -c "import warnings; warnings.filterwarnings('ignore'); from gliner2 import GLiNER2; GLiNER2.from_pretrained('${ENCODER_MODEL}')"

COPY server.py .
# Cloud Run sets PORT; the service must run with --concurrency=1 (inference is serialised anyway).
CMD ["python", "server.py"]
