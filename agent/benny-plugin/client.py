"""Talking to the Benny app's agent API and to Home Assistant, and knowing
who's asking.

The tokens stay in this process: the model never sees them, types them or
puts them in a command, so it can't leak them in a reply.
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

# The app's refusal for a route that isn't on the agent's allowlist.
ROUTE_REFUSED = "The agent isn't allowed to use this route."


class AppError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _send(method: str, url: str, token: str, body=None):
    """The HTTP part of call() and home_call(). Returns parsed JSON, or text
    for text responses; HTTP and network errors are left to the caller."""
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        text = response.read().decode("utf-8")
        is_json = "json" in response.headers.get("Content-Type", "")
        return json.loads(text) if is_json else text


def _error_field(err: urllib.error.HTTPError, field: str):
    with err:
        try:
            return json.loads(err.read().decode("utf-8")).get(field)
        except (ValueError, AttributeError):
            return None


def call(method: str, path: str, body=None):
    """One request to the app. Returns parsed JSON, or text for text responses."""
    base = os.environ.get("BENNY_API_URL", "").rstrip("/")
    token = os.environ.get("BENNY_AGENT_TOKEN", "")
    if not base or not token:
        raise AppError(0, "BENNY_API_URL or BENNY_AGENT_TOKEN isn't set on the Pi. Tell Michael.")

    try:
        return _send(method, base + path, token, body)
    except urllib.error.HTTPError as err:
        message = _error_field(err, "error")
        # A 403 is also how the app says "reconnect Google to add Gmail
        # access", so only the allowlist refusal gets the fixed hint.
        hint = STATUS_HINTS.get(err.code)
        if err.code == 403 and message and message != ROUTE_REFUSED:
            hint = None
        raise AppError(err.code, hint or message or str(err.reason)) from None
    except (urllib.error.URLError, TimeoutError) as err:
        raise AppError(0, f"Couldn't reach the Benny app ({err}). Try again in a minute.") from None


def home_call(method: str, path: str, body=None):
    """One request to Home Assistant's REST API, which runs on the same Pi
    as Hermes, so nothing goes through the app or Vercel. BENNY_HA_TOKEN is
    a Home Assistant long-lived access token; BENNY_HA_URL defaults to the
    Pi itself."""
    base = os.environ.get("BENNY_HA_URL", "http://127.0.0.1:8123").rstrip("/")
    token = os.environ.get("BENNY_HA_TOKEN", "")
    if not token:
        raise AppError(0, "BENNY_HA_TOKEN isn't set on the Pi, so Benny can't reach the smart home yet. Tell Michael.")

    try:
        return _send(method, base + path, token, body)
    except urllib.error.HTTPError as err:
        if err.code == 401:
            err.close()
            raise AppError(401, "Home Assistant rejected Benny's token. Tell Michael, and don't retry.") from None
        message = _error_field(err, "message")
        raise AppError(err.code, message or str(err.reason)) from None
    except (urllib.error.URLError, TimeoutError) as err:
        raise AppError(0, f"Couldn't reach Home Assistant on the Pi ({err}). Try again in a minute.") from None


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


def in_private_chat() -> bool:
    """True when the message came from a one-on-one DM with Benny (Discord
    or Telegram), where nobody else will see the reply. Same source as
    asker(): Hermes's session, not the model."""
    try:
        from gateway.session_context import get_session_env
    except ImportError:
        return False
    return get_session_env("HERMES_SESSION_CHAT_TYPE", "") == "dm"
