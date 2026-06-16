from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

import requests
import yaml

from .filters import MatchResult, evaluate_listing
from .github_issue import post_report_to_issue
from .models import Listing
from .notifier import send_search_notifications
from .parser import parse_html, parse_rss
from .state import is_seen, load_state, mark_seen, save_state


USER_AGENT = (
    "Mozilla/5.0 (compatible; WohnungssucheBot/0.1; "
    "+https://github.com/stewalpp/Wohnungssuche)"
)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    config = load_config(args.config)
    state = load_state(args.state)
    criteria = config.get("criteria", {})
    sources = [source for source in config.get("sources", []) if source.get("enabled", True)]
    if not sources:
        print("Keine aktiven Quellen in config/search.yml gefunden.", file=sys.stderr)
        return 2

    all_matches: list[tuple[Listing, MatchResult]] = []
    floor_review_matches: list[tuple[Listing, MatchResult]] = []
    errors: list[str] = []

    for source in sources:
        try:
            listings = fetch_and_parse_source(source)
        except Exception as exc:  # noqa: BLE001 - source failures should not hide other sources
            errors.append(f"{source.get('name', 'Quelle')}: {exc}")
            continue

        for listing in listings:
            result = evaluate_listing(listing, criteria)
            if is_seen(state, listing):
                continue
            if result.accepted:
                all_matches.append((listing, result))
            elif should_include_floor_review(result, criteria):
                floor_review_matches.append((listing, result))

    all_matches = dedupe_matches(all_matches)
    floor_review_matches = dedupe_matches(floor_review_matches)
    markdown = format_report(all_matches, floor_review_matches, errors)
    print(markdown)
    append_step_summary(markdown)

    reported_listings = [listing for listing, _ in all_matches + floor_review_matches]
    if reported_listings:
        issue_url = None
        if args.github_issue:
            issue_url = post_report_to_issue(markdown)
            if issue_url:
                print(f"\nGitHub Issue aktualisiert: {issue_url}")

        for notification_result in send_search_notifications(
            markdown,
            exact_matches=len(all_matches),
            review_candidates=len(floor_review_matches),
            issue_url=issue_url,
        ):
            print(notification_result)

        report_paths = write_reports(args.report, markdown)
        for report_path in report_paths:
            print(f"Report geschrieben: {report_path}")

        mark_seen(state, reported_listings)
        save_state(args.state, state)
        print(f"Seen-State aktualisiert: {args.state}")

    elif not args.report.exists():
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(markdown, encoding="utf-8")

    if errors and not all_matches:
        return 1
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Search new apartment listings.")
    parser.add_argument("--config", type=Path, default=Path("config/search.yml"))
    parser.add_argument("--state", type=Path, default=Path("data/seen_listings.json"))
    parser.add_argument("--report", type=Path, default=Path("reports/latest.md"))
    parser.add_argument(
        "--github-issue",
        action="store_true",
        help="Post new matches to the Neue Wohnungsangebote GitHub issue.",
    )
    return parser.parse_args(argv)


def load_config(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def fetch_and_parse_source(source: dict) -> list[Listing]:
    url = source["url"]
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    response.raise_for_status()
    content_type = response.headers.get("Content-Type", "").lower()
    source_type = source.get("type", "html").lower()

    if source_type == "rss" or "xml" in content_type:
        return parse_rss(response.content, source)
    if source_type == "html":
        return parse_html(response.content, source)
    raise ValueError(f"Unbekannter Quellentyp: {source_type}")


def dedupe_matches(
    matches: list[tuple[Listing, MatchResult]]
) -> list[tuple[Listing, MatchResult]]:
    seen: set[str] = set()
    deduped: list[tuple[Listing, MatchResult]] = []
    for listing, result in matches:
        if listing.id in seen:
            continue
        seen.add(listing.id)
        deduped.append((listing, result))
    return sorted(
        deduped,
        key=lambda item: (
            item[0].price_eur if item[0].price_eur is not None else 999999,
            item[0].source_name,
            item[0].title,
        ),
    )


def should_include_floor_review(result: MatchResult, criteria: dict) -> bool:
    if not criteria.get("include_floor_review_candidates", False):
        return False
    return any(reason.startswith("kein EG/Parterre") for reason in result.reasons)


def format_report(
    matches: list[tuple[Listing, MatchResult]],
    floor_review_matches: list[tuple[Listing, MatchResult]],
    errors: list[str],
) -> str:
    today = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [f"# Neue Wohnungsangebote ({today})", ""]

    if not matches and not floor_review_matches:
        lines.extend(
            [
                "Keine neuen passenden Inserate gefunden.",
                "",
                "Bereits bekannte Wohnungen wurden ausgeblendet.",
            ]
        )
    else:
        if matches:
            lines.append(f"{len(matches)} neue passende Inserate gefunden.")
            lines.append("")
            for index, (listing, result) in enumerate(matches, start=1):
                lines.extend(format_listing(index, listing, result, review_candidate=False))
                lines.append("")

        if floor_review_matches:
            lines.append("## Pruefkandidaten: Etage passt wahrscheinlich nicht")
            lines.append("")
            lines.append(
                "Diese Wohnungen passen bei Preis, Groesse, Zimmerzahl und Lage, "
                "liegen aber laut Suchseite nicht im EG/Parterre."
            )
            lines.append("")
            for index, (listing, result) in enumerate(floor_review_matches, start=1):
                lines.extend(format_listing(index, listing, result, review_candidate=True))
                lines.append("")

    if errors:
        lines.append("## Quellen mit Fehlern")
        lines.append("")
        for error in errors:
            lines.append(f"- {error}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def format_listing(
    index: int, listing: Listing, result: MatchResult, review_candidate: bool
) -> list[str]:
    price = f"{listing.price_eur:g} EUR" if listing.price_eur is not None else "Miete offen"
    area = f"{listing.area_sqm:g} qm" if listing.area_sqm is not None else "Flaeche offen"
    rooms = f"{listing.rooms:g} Zimmer" if listing.rooms is not None else "Zimmer offen"
    location = listing.location or "Lage aus Inserat pruefen"
    floor = listing.floor or "Etage pruefen"
    notes = ", ".join(result.review_notes) if result.review_notes else "keine"
    reasons = ", ".join(result.reasons) if result.reasons else "Kriterien teilweise im Text erkannt"

    reason_label = "Warum nicht perfekt" if review_candidate else "Warum passend"
    return [
        f"### {index}. {listing.title}",
        "",
        f"- Quelle: {listing.source_name}",
        f"- Preis: {price}",
        f"- Groesse/Zimmer: {area}, {rooms}",
        f"- Etage: {floor}",
        f"- Lage: {location}",
        f"- {reason_label}: {reasons}",
        f"- Bitte pruefen: {notes}",
        f"- Link: {listing.url}",
    ]


def write_reports(report_path: Path, markdown: str) -> list[Path]:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(markdown, encoding="utf-8")

    archive_dir = report_path.parent / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    archive_path = archive_dir / f"{stamp}.md"
    archive_path.write_text(markdown, encoding="utf-8")
    return [report_path, archive_path]


def append_step_summary(markdown: str) -> None:
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    with open(summary_path, "a", encoding="utf-8") as handle:
        handle.write(markdown)
        handle.write("\n")


if __name__ == "__main__":
    raise SystemExit(main())
