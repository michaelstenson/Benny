"""Talking to the Benny app's agent API, and knowing who's asking.

The token stays in this process: the model never sees it, types it or
puts it in a command, so it can't leak it in a reply.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

TIMEOUT_SECONDS = 30

PEOPLE = ("michael", "mer")

# What each refusal means for Benny, in place of a bare status code.
STATUS_HINTS = {
    401: "The app rejected Benny's token. Tell Michael, and don't retry.",
    403: "The app doesn't let Benny do that, on purpose. Say you can't, and don't look for a way around it.",
}


class AppError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def call(method: str, path: str, body=None):
    """One request to the app. Returns parsed JSON, or text for text responses."""
    base = os.environ.get("BENNY_API_URL", "").rstrip("/")
    token = os.environ.get("BENNY_AGENT_TOKEN", "")
    if not base or not token:
        raise AppError(0, "BENNY_API_URL or BENNY_AGENT_TOKEN isn't set on the Pi. Tell Michael.")

    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(base + path, data=data, method=method, headers=headers)

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            text = response.read().decode("utf-8")
            is_json = "json" in response.headers.get("Content-Type", "")
            return json.loads(text) if is_json else text
    except urllib.error.HTTPError as err:
        with err:
            try:
                message = json.loads(err.read().decode("utf-8")).get("error")
            except (ValueError, AttributeError):
                message = None
        raise AppError(err.code, STATUS_HINTS.get(err.code) or message or str(err.reason)) from None
    except (urllib.error.URLError, TimeoutError) as err:
        raise AppError(0, f"Couldn't reach the Benny app ({err}). Try again in a minute.") from None


def people() -> dict:
    """BENNY_PEOPLE maps chat accounts to people, e.g.
    "discord:123=michael,discord:456=mer,telegram:789=michael".
    It lives in the Pi's .env, not the repo, which is public."""
    mapping = {}
    for pair in os.environ.get("BENNY_PEOPLE", "").split(","):
        account, _, person = pair.strip().partition("=")
        person = person.strip().lower()
        if account.strip() and person in PEOPLE:
            mapping[account.strip()] = person
    return mapping


def asker():
    """'michael' or 'mer' for whoever sent the message being handled, or None.

    This comes from Hermes's session (the platform and the sender's user
    ID), never from anything the model passes in, so a message, an email
    or a calendar invite can't make Benny act as the other person. None
    (unknown sender, a cron run, the CLI, or a Hermes change that moves
    the session module) means anything tied to one person's account is
    refused rather than guessed.
    """
    try:
        from gateway.session_context import get_session_env
    except ImportError:
        return None
    platform = get_session_env("HERMES_SESSION_PLATFORM", "")
    user_id = get_session_env("HERMES_SESSION_USER_ID", "")
    if not platform or not user_id:
        return None
    return people().get(f"{platform}:{user_id}")
