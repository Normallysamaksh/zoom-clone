from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class MeetingInput(Input):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    scheduled_at: datetime | None = None
    duration: int = Field(default=30, ge=5, le=480)

    @field_validator("scheduled_at")
    @classmethod
    def future_date(cls, value):
        if value is not None:
            if value.tzinfo is None:
                raise ValueError("Include a timezone in the meeting date.")
            if value <= datetime.now(timezone.utc):
                raise ValueError("Choose a date and time in the future.")
        return value


class JoinInput(Input):
    name: str = Field(min_length=1, max_length=60)
    muted: bool = False
    video_off: bool = False
    host_token: str = Field(default="", max_length=200)


class HostInput(Input):
    host_token: str = Field(min_length=1, max_length=200)


class UpdateInput(Input):
    muted: bool | None = None
    video_off: bool | None = None
    hand_raised: bool | None = None


class SignalInput(Input):
    target_id: str = Field(min_length=1, max_length=60)
    kind: Literal["offer", "answer", "ice"]
    payload: dict


class ChatInput(Input):
    content: str = Field(min_length=1, max_length=2000)


class RemoveInput(Input):
    participant_id: str = Field(min_length=1, max_length=60)
