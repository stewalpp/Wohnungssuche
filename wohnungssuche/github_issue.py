from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request


API_ROOT = "https://api.github.com"
ISSUE_TITLE = "Neue Wohnungsangebote"
ISSUE_DASHBOARD_MARKER = "<!-- wohnungssuche-dashboard -->"
STATUS_COMMENT_MARKER = "<!-- wohnungssuche-status -->"


class GitHubIssueError(RuntimeError):
    pass


def post_report_to_issue(markdown: str, title: str = ISSUE_TITLE) -> str | None:
    token = os.environ.get("GITHUB_TOKEN")
    repository = os.environ.get("GITHUB_REPOSITORY")
    if not token or not repository:
        return None

    mentions = notification_mentions()
    body = f"{mentions}\n\n{markdown}" if mentions else markdown
    issue_number = find_or_create_issue(repository, token, title)
    created_comment = request_json(
        "POST",
        f"/repos/{repository}/issues/{issue_number}/comments",
        token,
        {"body": body},
    )
    update_issue_dashboard(
        repository,
        token,
        issue_number,
        markdown,
        created_comment.get("html_url") if created_comment else None,
    )
    return f"https://github.com/{repository}/issues/{issue_number}"


def post_run_status_to_issue(markdown: str, title: str = ISSUE_TITLE) -> str | None:
    token = os.environ.get("GITHUB_TOKEN")
    repository = os.environ.get("GITHUB_REPOSITORY")
    if not token or not repository:
        return None

    issue_number = find_or_create_issue(repository, token, title)
    status_body = status_body_from_report(markdown)
    update_issue_dashboard(
        repository,
        token,
        issue_number,
        markdown,
        find_latest_report_comment_url(repository, token, issue_number),
    )
    status_comment_id = find_status_comment(repository, token, issue_number)
    if status_comment_id is None:
        request_json(
            "POST",
            f"/repos/{repository}/issues/{issue_number}/comments",
            token,
            {"body": status_body},
        )
    else:
        request_json(
            "PATCH",
            f"/repos/{repository}/issues/comments/{status_comment_id}",
            token,
            {"body": status_body},
        )
    return f"https://github.com/{repository}/issues/{issue_number}"


def update_issue_dashboard(
    repository: str,
    token: str,
    issue_number: int,
    markdown: str,
    latest_report_url: str | None,
) -> None:
    request_json(
        "PATCH",
        f"/repos/{repository}/issues/{issue_number}",
        token,
        {"body": dashboard_body_from_report(markdown, latest_report_url)},
    )


def dashboard_body_from_report(markdown: str, latest_report_url: str | None = None) -> str:
    lines = [line.strip() for line in markdown.splitlines() if line.strip()]
    title = lines[0].lstrip("# ").strip() if lines else "Wohnungssuche"
    summary_lines = report_summary_lines(lines)
    summary = " ".join(summary_lines) if summary_lines else "Suchlauf wurde ausgefuehrt."
    report = markdown.strip()
    if report.startswith("# "):
        report = f"## {report[2:]}"

    body_lines = [
        ISSUE_DASHBOARD_MARKER,
        "# Aktueller Stand",
        "",
        f"**{title}**",
        "",
        summary,
        "",
    ]
    if latest_report_url:
        body_lines.extend(
            [
                f"Letzte Trefferliste: [Kommentar oeffnen]({latest_report_url})",
                "",
            ]
        )
    body_lines.extend(
        [
            "Der neueste Suchlauf steht immer hier oben. Fruehere Suchlaeufe bleiben unten in den Kommentaren.",
            "",
            "---",
            "",
            report,
        ]
    )
    return "\n".join(body_lines).rstrip() + "\n"


def find_latest_report_comment_url(repository: str, token: str, issue_number: int) -> str | None:
    comments = request_json(
        "GET",
        f"/repos/{repository}/issues/{issue_number}/comments?per_page=100",
        token,
    )
    for comment in reversed(comments):
        body = comment.get("body", "")
        if STATUS_COMMENT_MARKER in body:
            continue
        if re.search(r"\d+\s+neue passende Inserate gefunden", body):
            return str(comment.get("html_url", ""))
    return None


def find_status_comment(repository: str, token: str, issue_number: int) -> int | None:
    comments = request_json(
        "GET",
        f"/repos/{repository}/issues/{issue_number}/comments?per_page=100",
        token,
    )
    for comment in comments:
        if STATUS_COMMENT_MARKER in comment.get("body", ""):
            return int(comment["id"])
    return None


def status_body_from_report(markdown: str) -> str:
    lines = [line.strip() for line in markdown.splitlines() if line.strip()]
    title = lines[0].lstrip("# ").strip() if lines else "Wohnungssuche"
    summary_lines = report_summary_lines(lines)
    summary = " ".join(summary_lines) if summary_lines else "Suchlauf wurde ausgefuehrt."
    error_sources = error_sources_from_report(lines)

    body = (
        f"{STATUS_COMMENT_MARKER}\n"
        "## Letzter Suchlauf\n\n"
        f"**{title}**\n\n"
        f"{summary}\n\n"
        "Neue passende Wohnungen erscheinen weiterhin als eigener Kommentar mit "
        "Benachrichtigung. Bereits bekannte Inserate werden nicht erneut gepostet."
    )
    if error_sources:
        body += (
            "\n\n**Hinweis:** Diese Quellen hatten beim letzten Lauf Probleme: "
            f"{', '.join(error_sources)}."
        )
    return body


def report_summary_lines(lines: list[str]) -> list[str]:
    summary_lines: list[str] = []
    for line in lines[1:]:
        if line.startswith("### ") or line.startswith("<details>"):
            break
        if line.startswith("#") or line.startswith("- ") or line.startswith("<"):
            continue
        summary_lines.append(line)
        if "neue passende Inserate gefunden" in line:
            break
        if len(summary_lines) >= 2:
            break
    return summary_lines


def error_sources_from_report(lines: list[str]) -> list[str]:
    sources: list[str] = []
    in_error_section = False
    for line in lines:
        if line == "## Quellen mit Fehlern":
            in_error_section = True
            continue
        if in_error_section and line.startswith("## "):
            break
        if in_error_section and line.startswith("- "):
            source_name = line[2:].split(":", 1)[0].strip()
            if source_name:
                sources.append(source_name)
    return sources


def notification_mentions() -> str:
    raw_value = os.environ.get("GITHUB_NOTIFICATION_USERS") or os.environ.get(
        "GITHUB_NOTIFICATION_USER", ""
    )
    users = []
    for user in re.split(r"[\s,]+", raw_value):
        normalized = user.strip().lstrip("@")
        if normalized and normalized not in users:
            users.append(normalized)
    return " ".join(f"@{user}" for user in users)


def find_or_create_issue(repository: str, token: str, title: str) -> int:
    issues = request_json("GET", f"/repos/{repository}/issues?state=open&per_page=100", token)
    for issue in issues:
        if issue.get("title") == title and "pull_request" not in issue:
            return int(issue["number"])

    created = request_json(
        "POST",
        f"/repos/{repository}/issues",
        token,
        {
            "title": title,
            "body": (
                "Hier postet die taegliche Wohnungssuche neue passende Inserate. "
                "Bereits gemeldete Wohnungen werden nicht wiederholt."
            ),
        },
    )
    return int(created["number"])


def request_json(method: str, path: str, token: str, payload: dict | None = None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{API_ROOT}{path}",
        data=data,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "wohnungssuche-bot",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise GitHubIssueError(f"GitHub API failed ({exc.code}): {detail}") from exc
