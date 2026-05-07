from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class Candidate(BaseModel):
    name: str
    party: str = ""
    votes: int = Field(ge=0)


class Contest(BaseModel):
    office: str
    candidates: list[Candidate]

    @field_validator("candidates")
    @classmethod
    def non_empty(cls, v: list[Candidate]) -> list[Candidate]:
        if not v:
            raise ValueError("Each contest must have at least one candidate")
        return v


class Jurisdiction(BaseModel):
    id: str | None = None
    name: str
    registered_voters: int | None = Field(default=None, ge=0)
    ballots_cast: int | None = Field(default=None, ge=0)
    contests: list[Contest]


class ElectionRecord(BaseModel):
    election_id: str
    title: str
    reported_at: datetime | None = None
    jurisdictions: list[Jurisdiction]

    @field_validator("jurisdictions")
    @classmethod
    def non_empty(cls, v: list[Jurisdiction]) -> list[Jurisdiction]:
        if not v:
            raise ValueError("At least one jurisdiction is required")
        return v
