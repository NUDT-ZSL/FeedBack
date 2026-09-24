"""项目文件读写（JSON，纯本地，无网络依赖）。"""
from __future__ import annotations

import json

from .models import Anchor, MediaInfo, Segment


def load_project(path: str):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    m = data["media"]
    media = MediaInfo(duration=float(m["duration"]), fps=float(m["fps"]))
    segments = [Segment(id=s["id"], start=float(s["start"]),
                        end=float(s["end"]), text=s.get("text", ""),
                        source=s.get("source", ""),
                        anchor_id=s.get("anchor_id"))
                for s in data.get("segments", [])]
    anchors = [Anchor(id=a["id"], media_time=float(a["media_time"]),
                      label=a.get("label", ""))
               for a in data.get("anchors", [])]
    return media, segments, anchors


def save_project(path: str, media: MediaInfo, segments: list,
                 anchors: list, resolutions: dict = None):
    data = {
        "media": {"duration": media.duration, "fps": media.fps},
        "anchors": [{"id": a.id, "media_time": a.media_time,
                     "label": a.label} for a in anchors],
        "segments": [{"id": s.id, "start": s.start, "end": s.end,
                      "text": s.text, "source": s.source,
                      "anchor_id": s.anchor_id} for s in segments],
        "resolutions": resolutions or {},
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
