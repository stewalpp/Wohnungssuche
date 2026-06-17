from __future__ import annotations

import base64
import os
import smtplib
import urllib.parse
import urllib.request
from email.message import EmailMessage


def send_search_notifications(
    markdown: str,
    *,
    exact_matches: int,
    review_candidates: int,
    issue_url: str | None = None,
) -> list[str]:
    subject = build_subject(exact_matches, review_candidates)
    sms_body = build_sms_body(exact_matches, review_candidates, issue_url)
    results: list[str] = []

    email_result = try_delivery("E-Mail", lambda: send_email(subject, markdown, issue_url))
    if email_result:
        results.append(email_result)

    sms_result = try_delivery("SMS", lambda: send_sms(sms_body))
    if sms_result:
        results.append(sms_result)

    ntfy_result = try_delivery(
        "ntfy", lambda: send_ntfy(exact_matches, review_candidates, issue_url)
    )
    if ntfy_result:
        results.append(ntfy_result)

    return results


def build_subject(exact_matches: int, review_candidates: int) -> str:
    parts: list[str] = []
    if exact_matches:
        parts.append(f"{exact_matches} Treffer")
    if review_candidates:
        parts.append(f"{review_candidates} Pruefkandidaten")
    summary = ", ".join(parts) if parts else "keine neuen Treffer"
    return f"Wohnungssuche: {summary}"


def build_sms_body(
    exact_matches: int, review_candidates: int, issue_url: str | None = None
) -> str:
    lines = [build_subject(exact_matches, review_candidates)]
    if issue_url:
        lines.append(f"Details: {issue_url}")
    return "\n".join(lines)


def send_email(subject: str, markdown: str, issue_url: str | None = None) -> str | None:
    to_address = os.environ.get("NOTIFY_EMAIL_TO")
    host = os.environ.get("SMTP_HOST")
    username = os.environ.get("SMTP_USERNAME")
    password = os.environ.get("SMTP_PASSWORD")
    from_address = os.environ.get("SMTP_FROM") or username
    if not all([to_address, host, username, password, from_address]):
        return None

    port = int(os.environ.get("SMTP_PORT") or "587")
    starttls = env_bool("SMTP_STARTTLS", default=True)
    body = markdown
    if issue_url:
        body = f"{markdown.rstrip()}\n\nGitHub Issue: {issue_url}\n"

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = from_address
    message["To"] = to_address
    message.set_content(body)

    with smtplib.SMTP(host, port, timeout=30) as smtp:
        if starttls:
            smtp.starttls()
        smtp.login(username, password)
        smtp.send_message(message)

    return f"E-Mail gesendet an {mask_email(to_address)}"


def send_sms(body: str) -> str | None:
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
    from_number = os.environ.get("TWILIO_FROM_NUMBER")
    to_number = os.environ.get("SMS_TO_NUMBER")
    if not all([account_sid, auth_token, from_number, to_number]):
        return None

    payload = urllib.parse.urlencode(
        {
            "From": from_number,
            "To": to_number,
            "Body": body,
        }
    ).encode("utf-8")
    auth = base64.b64encode(f"{account_sid}:{auth_token}".encode("utf-8")).decode("ascii")
    request = urllib.request.Request(
        f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "wohnungssuche-bot",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        response.read()

    return f"SMS gesendet an {mask_phone(to_number)}"


def send_ntfy(
    exact_matches: int, review_candidates: int, issue_url: str | None = None
) -> str | None:
    """Free instant push via ntfy.sh (or a self-hosted server).

    Sends only when NTFY_TOPIC is set. The topic is the only access control, so
    it should be long/unguessable. Header values stay ASCII; the body is UTF-8.
    """
    topic = os.environ.get("NTFY_TOPIC")
    if not topic or not topic.strip():
        return None
    topic = topic.strip()
    server = (os.environ.get("NTFY_SERVER") or "https://ntfy.sh").rstrip("/")

    lines: list[str] = []
    if exact_matches:
        lines.append(f"{exact_matches} neue passende Wohnung(en)")
    if review_candidates:
        lines.append(f"{review_candidates} Pruefkandidat(en) zum Pruefen")
    body = "\n".join(lines) or "Neue Suchergebnisse"

    headers = {
        "Title": "Wohnungssuche: neue Treffer",  # header values must stay ASCII
        "Priority": "high",
        "Tags": "house",
        "User-Agent": "wohnungssuche-bot",
    }
    click = os.environ.get("NTFY_CLICK") or issue_url
    if click:
        headers["Click"] = click

    request = urllib.request.Request(
        f"{server}/{urllib.parse.quote(topic)}",
        data=body.encode("utf-8"),
        method="POST",
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        response.read()

    return f"ntfy gesendet (Topic {mask_topic(topic)})"


def env_bool(name: str, *, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def try_delivery(label: str, delivery) -> str | None:
    try:
        return delivery()
    except Exception as exc:  # noqa: BLE001 - notification failures should not break search
        return f"{label} fehlgeschlagen: {type(exc).__name__}"


def mask_email(value: str) -> str:
    local, separator, domain = value.partition("@")
    if not separator:
        return "***"
    visible = local[:2] if len(local) > 2 else local[:1]
    return f"{visible}***@{domain}"


def mask_phone(value: str) -> str:
    digits = "".join(character for character in value if character.isdigit())
    if len(digits) <= 4:
        return "***"
    return f"***{digits[-4:]}"


def mask_topic(value: str) -> str:
    return f"{value[:6]}***" if len(value) > 6 else "***"
