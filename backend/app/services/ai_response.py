"""Accepted text and safe provenance returned by an AI transport."""
from dataclasses import dataclass


@dataclass(frozen=True)
class JsonGeneration:
    content: str
    model_version: str
    trace: dict
