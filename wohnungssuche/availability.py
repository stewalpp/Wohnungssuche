from __future__ import annotations

import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

from .github_issue import post_report_to_issue
from .models import canonical_url
from .search import fetch_and_parse_source, load_config
from .state import load_state, save_state


STATUS_AVAILABLE = "available"
STATUS_UNAVAILABLE = "unavailable"
STATUS_UNKNOWN = "unknown"


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    config = load_config(args.config)
    state = load_state(args.state)
    now = datetime.now(timezone.utc).isoformat()

    current_ids, current_urls, source_errors, active_sources = collect_current_listings(config)
    changes = update_availability(
        state,
        current_ids=current_ids,
        current_urls=current_urls,
        source_errors=source_errors,
        active_sources=active_sources,
        checked_at=now,
    )

    markdown = format_report(state, changes, source_errors)
    print(markdown)
    append_step_summary(markdown)
    write_report(args.report, markdown)
    save_state(args.state, state)

    if args.github_issue and should_notify(changes):
        issue_url = post_report_to_issue(markdown)
        if issue_url:
            print(f"\nGitHub Issue aktualisiert: {issue_url}")

    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check availability of previous listings.")
    parser.add_argument("--config", type=Path, default=Path("config/search.yml"))
    parser.add_argument("--state", type=Path, default=Path("data/seen_listings.json"))
    parser.add_argument("--report", type=Path, default=Path("reports/availability.md"))
    parser.add_argument(
        "--github-issue",
        action="store_true",
        help="Post changed availability to the Neue Wohnungsangebote GitHub issue.",
    )
    return parser.parse_args(argv)


def collect_current_listings(
    config: dict,
) -> tuple[set[str], set[str], dict[str, str], set[str]]:
    current_ids: set[str] = set()
    current_urls: set[str] = set()
    source_errors: dict[str, str] = {}
    active_sources: set[str] = set()

    for source in config.get("sources", []):
        source_name = source.get("name", "Quelle")
        if not source.get("enabled", True):
            continue
        active_sources.add(source_name)
        try:
            listings = fetch_and_parse_source(source)
        except Exception as exc:  # noqa: BLE001 - one source should not stop the audit
            source_errors[source_name] = str(exc)
            continue
        for listing in listings:
            current_ids.add(listing.id)
            current_urls.add(canonical_url(listing.url))

    return current_ids, current_urls, source_errors, active_sources


def update_availability(
    state: dict,
    *,
    current_ids: set[str],
    current_urls: set[str],
    source_errors: dict[str, str],
    active_sources: set[str],
    checked_at: str,
) -> list[dict]:
    changes: list[dict] = []
    for listing_id, item in sorted(state.get("seen", {}).items()):
        previous_status = item.get("availability_status")
        new_status, note = determine_availability(
            listing_id,
            item,
            current_ids=current_ids,
            current_urls=current_urls,
            source_errors=source_errors,
            active_sources=active_sources,
        )

        item["availability_status"] = new_status
        item["last_checked"] = checked_at
        item["last_check_note"] = note

        if new_status == STATUS_AVAILABLE:
            item["last_seen_in_search"] = checked_at
            item.pop("last_missing_from_search", None)
        elif new_status == STATUS_UNAVAILABLE:
            item["last_missing_from_search"] = checked_at

        if previous_status != new_status:
            item["status_changed_at"] = checked_at
            changes.append(
                {
                    "id": listing_id,
                    "previous_status": previous_status,
                    "new_status": new_status,
                    "note": note,
                    "item": item,
                }
            )

    return changes


def determine_availability(
    listing_id: str,
    item: dict,
    *,
    current_ids: set[str],
    current_urls: set[str],
    source_errors: dict[str, str],
    active_sources: set[str],
) -> tuple[str, str]:
    url = canonical_url(item.get("url", ""))
    source_name = item.get("source", "")
    if listing_id in current_ids or url in current_urls:
        return STATUS_AVAILABLE, "Inserat wurde in den aktuellen Suchergebnissen gefunden."

    if source_name in source_errors:
        return STATUS_UNKNOWN, f"Quelle konnte nicht geprueft werden: {source_errors[source_name]}"

    if source_name and source_name not in active_sources:
        return STATUS_UNKNOWN, "Quelle ist aktuell deaktiviert."

    return STATUS_UNAVAILABLE, "Inserat ist nicht mehr in den aktuellen Suchergebnissen."


def should_notify(changes: list[dict]) -> bool:
    return any(
        change["new_status"] == STATUS_UNAVAILABLE
        or (
            change["previous_status"] == STATUS_UNAVAILABLE
            and change["new_status"] == STATUS_AVAILABLE
        )
        for change in changes
    )


def format_report(state: dict, changes: list[dict], source_errors: dict[str, str]) -> str:
    checked_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    seen = state.get("seen", {})
    counts = count_statuses(seen)
    lines = [
        f"# Verfuegbarkeitscheck ({checked_at})",
        "",
        f"Gepruefte bekannte Inserate: {len(seen)}",
        f"- Sichtbar in aktuellen Suchergebnissen: {counts.get(STATUS_AVAILABLE, 0)}",
        f"- Nicht mehr in Suchergebnissen: {counts.get(STATUS_UNAVAILABLE, 0)}",
        f"- Unbekannt, weil Quelle nicht pruefbar war: {counts.get(STATUS_UNKNOWN, 0)}",
        "",
    ]

    newly_unavailable = [
        change for change in changes if change["new_status"] == STATUS_UNAVAILABLE
    ]
    newly_available = [
        change
        for change in changes
        if change["previous_status"] == STATUS_UNAVAILABLE
        and change["new_status"] == STATUS_AVAILABLE
    ]

    if newly_unavailable:
        lines.extend(format_change_section("Neu nicht mehr gefunden", newly_unavailable))
    if newly_available:
        lines.extend(format_change_section("Wieder in der Suche sichtbar", newly_available))
    if not newly_unavailable and not newly_available:
        lines.extend(["Keine relevanten Statusaenderungen seit dem letzten Check.", ""])

    unavailable_items = [
        {"id": listing_id, "item": item, "note": item.get("last_check_note", "")}
        for listing_id, item in sorted(seen.items())
        if item.get("availability_status") == STATUS_UNAVAILABLE
    ]
    if unavailable_items:
        lines.extend(format_change_section("Aktuell nicht mehr gefunden", unavailable_items))

    if source_errors:
        lines.extend(["## Quellen mit Fehlern", ""])
        for source_name, error in sorted(source_errors.items()):
            lines.append(f"- {source_name}: {error}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def count_statuses(seen: dict) -> dict[str, int]:
    counts = {STATUS_AVAILABLE: 0, STATUS_UNAVAILABLE: 0, STATUS_UNKNOWN: 0}
    for item in seen.values():
        status = item.get("availability_status", STATUS_UNKNOWN)
        counts[status] = counts.get(status, 0) + 1
    return counts


def format_change_section(title: str, changes: list[dict]) -> list[str]:
    lines = [f"## {title}", ""]
    for index, change in enumerate(changes, start=1):
        item = change["item"]
        title_text = item.get("title", "(ohne Titel)")
        lines.extend(
            [
                f"### {index}. {title_text}",
                "",
                f"- Quelle: {item.get('source', 'unbekannt')}",
                f"- Link: {item.get('url', '')}",
                f"- Hinweis: {change.get('note') or item.get('last_check_note', '')}",
                "",
            ]
        )
    return lines


def write_report(report_path: Path, markdown: str) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(markdown, encoding="utf-8")


def append_step_summary(markdown: str) -> None:
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    with open(summary_path, "a", encoding="utf-8") as handle:
        handle.write(markdown)
        handle.write("\n")


if __name__ == "__main__":
    raise SystemExit(main())
