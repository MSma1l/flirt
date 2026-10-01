"""Scheme pentru documentele legale și consimțăminte (`/api/v1/legal/*`)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

ConsentDocument = Literal["terms", "privacy", "sensitive_data"]


class LegalDocumentOut(BaseModel):
    document: str
    lang: str
    version: str
    effective_date: date
    title: str
    content: str  # Markdown (subset: titluri, paragrafe, liste, **bold**, linkuri)
    missing_placeholders: list[str] = []


class AcceptedConsentOut(BaseModel):
    version: str
    accepted_at: datetime
    withdrawn_at: datetime | None = None


class ConsentStatusOut(BaseModel):
    consent_required: bool
    required_documents: list[str]
    current_versions: dict[str, str]
    accepted: dict[str, AcceptedConsentOut | None]
    sensitive_data_consent: bool


class ConsentIn(BaseModel):
    documents: list[ConsentDocument] = Field(min_length=1, max_length=3)
    versions: dict[str, str] = Field(default_factory=dict)

    @field_validator("documents")
    @classmethod
    def _unique(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("documente duplicate")
        return v

    @field_validator("versions")
    @classmethod
    def _short_versions(cls, v: dict[str, str]) -> dict[str, str]:
        if len(v) > 3 or any(len(k) > 32 or len(x) > 32 for k, x in v.items()):
            raise ValueError("versiuni invalide")
        return v


class ConsentWithdrawIn(BaseModel):
    documents: list[ConsentDocument] = Field(min_length=1, max_length=3)
