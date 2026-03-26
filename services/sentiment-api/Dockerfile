FROM python:3.12-slim

WORKDIR /app

# Install build deps for torch
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc curl && rm -rf /var/lib/apt/lists/*

# Install PyTorch CPU-only (much smaller than GPU build) + transformers + fastapi
RUN pip install --no-cache-dir \
    torch==2.5.1+cpu \
    --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir \
    transformers==4.47.1 \
    fastapi==0.115.6 \
    uvicorn[standard]==0.34.0 \
    pydantic==2.10.3

COPY app.py .

# Pre-download the model into the image layer on build
# (so container starts fast — no download on each run)
RUN python -c "from transformers import pipeline; pipeline('text-classification', model='ElKulako/cryptobert', top_k=None)"

EXPOSE 80

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "80", "--workers", "1"]
