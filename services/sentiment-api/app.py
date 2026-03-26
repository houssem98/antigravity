"""
CryptoBERT Sentiment API
========================
Minimal FastAPI wrapper around ElKulako/cryptobert.
Trained on 3.2M crypto social media posts (StockTwits, Telegram, Reddit, Twitter).
Labels: Bearish (0) | Neutral (1) | Bullish (2)

Endpoint:
  POST /classify
    body:  { "inputs": "text" }
      or   { "inputs": ["text1", "text2", ...] }
    returns: [[{"label":"Bullish","score":0.94}, ...], ...]

  GET  /health  → {"status": "ok", "model": "ElKulako/cryptobert"}
"""

import os
import logging
from contextlib import asynccontextmanager
from typing import Union

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import pipeline

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("sentiment-api")

MODEL_ID = os.getenv("MODEL_ID", "ElKulako/cryptobert")
MAX_LENGTH = int(os.getenv("MAX_LENGTH", "128"))

# Global classifier — loaded once at startup
classifier = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global classifier
    log.info(f"Loading model: {MODEL_ID}")
    classifier = pipeline(
        "text-classification",
        model=MODEL_ID,
        tokenizer=MODEL_ID,
        top_k=None,            # return all labels with scores
        truncation=True,
        max_length=MAX_LENGTH,
    )
    log.info("Model loaded — ready")
    yield
    classifier = None


app = FastAPI(title="CryptoBERT Sentiment API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ClassifyRequest(BaseModel):
    inputs: Union[str, list[str]]


@app.get("/health")
def health():
    if classifier is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")
    return {"status": "ok", "model": MODEL_ID}


@app.post("/classify")
def classify(req: ClassifyRequest):
    if classifier is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    texts = req.inputs if isinstance(req.inputs, list) else [req.inputs]
    if not texts:
        return []

    # Truncate to 512 chars before tokenization for safety
    truncated = [t[:512] for t in texts]

    results = classifier(truncated)

    # Normalise label format to match TEI: [{"label":"Bullish","score":0.94}, ...]
    # CryptoBERT labels: LABEL_0 = Bearish, LABEL_1 = Neutral, LABEL_2 = Bullish
    LABEL_MAP = {"LABEL_0": "Bearish", "LABEL_1": "Neutral", "LABEL_2": "Bullish",
                 "Bearish": "Bearish", "Neutral": "Neutral", "Bullish": "Bullish"}

    normalized = []
    for result in results:
        # result is a list of {label, score} dicts (top_k=None)
        normalized.append([
            {"label": LABEL_MAP.get(r["label"], r["label"]), "score": round(r["score"], 4)}
            for r in sorted(result, key=lambda x: x["score"], reverse=True)
        ])

    return normalized
