from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_keys, asr, custom_styles, downloads, files, fonts, health, ocr, projects, render, tts, videos

app = FastAPI(title="VideoAUTO Storage API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length", "Content-Type"],
)

ROUTERS = [
    health.router,
    projects.router,
    api_keys.router,
    custom_styles.router,
    files.router,
    fonts.router,
    asr.router,
    tts.router,
    videos.router,
    render.router,
    ocr.router,
    downloads.router,
]

for router in ROUTERS:
    app.include_router(router)

__all__ = ["app"]
