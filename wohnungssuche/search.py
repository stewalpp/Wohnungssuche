from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
import yaml
from bs4 import BeautifulSoup

from .feed import DEFAULT_FEED_PATH, record_listings, write_feed
from .filters import MatchResult, evaluate_listing, normalize_text, term_in_text
from .github_issue import post_report_to_issue, post_run_status_to_issue
from .models import Listing
from .notifier import send_search_notifications
from .parser import build_listing, parse_html, parse_rss
from .state import is_seen, load_state, mark_seen, save_state


USER_AGENT = (
    "Mozilla/5.0 (compatible; WohnungssucheBot/0.1; "
    "+https://github.com/stewalpp/Wohnungssuche)"
)
REQUEST_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.6,en;q=0.5",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}
RETRYABLE_STATUS_CODES = {403, 429, 500, 502, 503, 504}
RATING_PEOPLE = (
    ("stewalpp", "Blau", "\U0001F535"),
    ("gishaa-create", "Gruen", "\U0001F7E2"),
)
RATING_CHOICES = ("Gut", "Vielleicht", "Schlecht")
NEW_LISTING_MARKER = "\U0001F7E9 NEU"
REVIEW_LISTING_MARKER = "\U0001F7E8 PRUEFEN"
CRITICAL_REVIEW_NOTES = {
    "Etage pruefen",
    "Wohnflaeche pruefen",
    "Miete und Nebenkosten pruefen",
    "Zimmerzahl pruefen",
    "Lage im Suchgebiet pruefen",
}


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
    feed_candidates: list[tuple[Listing, MatchResult]] = []
    errors: list[str] = []
    successful_sources = 0

    for source in sources:
        try:
            listings = fetch_and_parse_source(source)
        except Exception as exc:  # noqa: BLE001 - source failures should not hide other sources
            errors.append(f"{source.get('name', 'Quelle')}: {exc}")
            continue
        successful_sources += 1

        for listing in listings:
            result = evaluate_listing(listing, criteria)
            already_seen = is_seen(state, listing)
            if already_seen:
                if result.accepted or should_include_floor_review(result, criteria):
                    feed_candidates.append((listing, result))
                continue

            if should_fetch_detail_page(result, criteria):
                listing = enrich_listing_from_detail_page(listing)
                result = evaluate_listing(listing, criteria)

            # The app feed collects every eligible listing regardless of whether
            # it was already reported; the report below still only shows new ones.
            if result.accepted or should_include_floor_review(result, criteria):
                feed_candidates.append((listing, result))

            if result.accepted and not should_show_as_review_candidate(result, criteria):
                all_matches.append((listing, result))
            elif result.accepted or should_include_floor_review(result, criteria):
                floor_review_matches.append((listing, result))

    all_matches, floor_review_matches = dedupe_report_matches(
        all_matches,
        floor_review_matches,
        criteria,
    )
    markdown = format_report(all_matches, floor_review_matches, errors, criteria)
    print_markdown(markdown)
    append_step_summary(markdown)

    reported_listings = [listing for listing, _ in all_matches + floor_review_matches]
    issue_url = None
    if args.github_issue:
        issue_url = post_run_status_to_issue(markdown)
        if issue_url:
            print(f"\nGitHub Issue Status aktualisiert: {issue_url}")

    if reported_listings:
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

        report_paths = write_reports(
            args.report,
            markdown,
            all_matches + floor_review_matches,
            criteria,
        )
        for report_path in report_paths:
            print(f"Report geschrieben: {report_path}")

        mark_seen(state, reported_listings)

    elif not args.report.exists():
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(markdown, encoding="utf-8")

    # Enrich the state with full data for every eligible listing found this run
    # and (re)write the app feed + state on every run, so the PWA always shows
    # the current snapshot — independent of whether there were new matches.
    now_utc = datetime.now(timezone.utc).isoformat()
    generated_at = datetime.now(ZoneInfo("Europe/Berlin")).isoformat(timespec="seconds")
    record_listings(state, dedupe_feed_candidates(feed_candidates), now_utc)
    feed_path = write_feed(args.feed, state, criteria, generated_at)
    print(f"App-Feed geschrieben: {feed_path}")
    save_state(args.state, state)
    print(f"Seen-State aktualisiert: {args.state}")

    if should_fail_run(errors, successful_sources):
        return 1
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Search new apartment listings.")
    parser.add_argument("--config", type=Path, default=Path("config/search.yml"))
    parser.add_argument("--state", type=Path, default=Path("data/seen_listings.json"))
    parser.add_argument("--report", type=Path, default=Path("reports/latest.md"))
    parser.add_argument(
        "--feed",
        type=Path,
        default=DEFAULT_FEED_PATH,
        help="JSON feed consumed by the web app (GitHub Pages).",
    )
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
    response = fetch_url(url)
    content_type = response.headers.get("Content-Type", "").lower()
    source_type = source.get("type", "html").lower()

    if source_type == "rss" or "xml" in content_type:
        return parse_rss(response.content, source)
    if source_type == "html":
        return parse_html(response.content, source)
    raise ValueError(f"Unbekannter Quellentyp: {source_type}")


def fetch_url(url: str) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            response = requests.get(url, headers=REQUEST_HEADERS, timeout=30)
            if response.status_code in RETRYABLE_STATUS_CODES and attempt < 2:
                time.sleep(2**attempt)
                continue
            response.raise_for_status()
            return response
        except requests.RequestException as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(2**attempt)
                continue
            raise
    if last_error:
        raise last_error
    raise RuntimeError(f"Quelle konnte nicht geladen werden: {url}")


def should_fetch_detail_page(result: MatchResult, criteria: dict) -> bool:
    if result.accepted:
        return True
    return should_include_floor_review(result, criteria)


def enrich_listing_from_detail_page(listing: Listing) -> Listing:
    if not listing.url:
        return listing
    try:
        response = fetch_url(listing.url)
    except requests.RequestException:
        return listing

    detail_text = BeautifulSoup(response.content, "html.parser").get_text(" ", strip=True)
    if len(detail_text) < 80:
        return listing

    combined_text = " ".join([listing.title, listing.text, detail_text])
    detail = build_listing(listing.source_name, listing.title, listing.url, combined_text)
    return merge_listing_details(listing, detail)


def merge_listing_details(original: Listing, detail: Listing) -> Listing:
    return Listing(
        source_name=original.source_name,
        title=best_title(original.title, detail.title),
        url=original.url,
        text=" ".join([original.text, detail.text]),
        price_eur=detail.price_eur if detail.price_eur is not None else original.price_eur,
        area_sqm=detail.area_sqm if detail.area_sqm is not None else original.area_sqm,
        rooms=detail.rooms if detail.rooms is not None else original.rooms,
        location=detail.location or original.location,
        floor=detail.floor or original.floor,
        published=original.published or detail.published,
        image=detail.image or original.image,
    )


def best_title(original: str, detail: str) -> str:
    if not detail or detail == "(ohne Titel)":
        return original
    if not original or original == "(ohne Titel)":
        return detail
    return detail if len(detail) > len(original) else original


def dedupe_matches(
    matches: list[tuple[Listing, MatchResult]],
    criteria: dict | None = None,
) -> list[tuple[Listing, MatchResult]]:
    seen_ids: set[str] = set()
    seen_fingerprints: set[str] = set()
    deduped: list[tuple[Listing, MatchResult]] = []
    for listing, result in matches:
        fingerprint = listing_fingerprint(listing)
        if listing.id in seen_ids or (fingerprint and fingerprint in seen_fingerprints):
            continue
        seen_ids.add(listing.id)
        if fingerprint:
            seen_fingerprints.add(fingerprint)
        deduped.append((listing, result))
    return sorted(
        deduped,
        key=lambda item: (
            -score_listing(item[0], item[1], criteria or {})[0],
            item[0].price_eur if item[0].price_eur is not None else 999999,
            item[0].source_name,
            item[0].title,
        ),
    )


def dedupe_report_matches(
    matches: list[tuple[Listing, MatchResult]],
    floor_review_matches: list[tuple[Listing, MatchResult]],
    criteria: dict | None = None,
) -> tuple[list[tuple[Listing, MatchResult]], list[tuple[Listing, MatchResult]]]:
    floor_review_ids = {listing.id for listing, _ in floor_review_matches}
    floor_review_fingerprints = {
        fingerprint
        for listing, _ in floor_review_matches
        if (fingerprint := listing_fingerprint(listing))
    }
    exact_matches = [
        item
        for item in matches
        if item[0].id not in floor_review_ids
        and listing_fingerprint(item[0]) not in floor_review_fingerprints
    ]
    return dedupe_matches(exact_matches, criteria), dedupe_matches(floor_review_matches, criteria)


def listing_fingerprint(listing: Listing) -> str:
    if listing.price_eur is None or listing.area_sqm is None or listing.rooms is None:
        return ""
    location = normalize_text(listing.location or listing.text)
    title = normalize_text(listing.title)
    title_words = " ".join(word for word in title.split() if len(word) > 3)[:50]
    return "|".join(
        [
            str(round(listing.price_eur)),
            str(round(listing.area_sqm)),
            str(round(listing.rooms * 10) / 10),
            location[:60],
            title_words,
        ]
    )


def dedupe_feed_candidates(
    feed_candidates: list[tuple[Listing, MatchResult]]
) -> list[tuple[Listing, MatchResult]]:
    """Collapse duplicate listing ids, preferring an accepted match over a review."""
    by_id: dict[str, tuple[Listing, MatchResult]] = {}
    for listing, result in feed_candidates:
        existing = by_id.get(listing.id)
        if existing is None or (result.accepted and not existing[1].accepted):
            by_id[listing.id] = (listing, result)
    return list(by_id.values())


def should_include_floor_review(result: MatchResult, criteria: dict) -> bool:
    if not criteria.get("include_floor_review_candidates", False):
        return False
    return any(reason.startswith("kein EG/Parterre") for reason in result.reasons)


def should_show_as_review_candidate(result: MatchResult, criteria: dict) -> bool:
    if should_include_floor_review(result, criteria):
        return True
    return any(note in CRITICAL_REVIEW_NOTES for note in result.review_notes)


def score_listing(
    listing: Listing,
    result: MatchResult,
    criteria: dict | None = None,
) -> tuple[int, str, str]:
    criteria = criteria or {}
    score = 0

    if listing.price_eur is not None:
        max_rent = criteria.get("max_total_rent_eur")
        if max_rent is None or listing.price_eur <= float(max_rent):
            score += 20
        if max_rent is not None and listing.price_eur <= float(max_rent) * 0.9:
            score += 5

    if listing.area_sqm is not None:
        min_area = criteria.get("min_area_sqm")
        if min_area is None or listing.area_sqm >= float(min_area):
            score += 15
        if min_area is not None and listing.area_sqm >= float(min_area) + 10:
            score += 5

    if listing.rooms is not None:
        min_rooms = criteria.get("min_rooms")
        if min_rooms is None or listing.rooms >= float(min_rooms):
            score += 10

    if criteria.get("require_ground_floor", False):
        if has_desired_floor(listing, criteria):
            score += 25
        elif any(reason.startswith("kein EG/Parterre") for reason in result.reasons):
            score -= 20
        elif "Etage pruefen" in result.review_notes:
            score += 5

    location_score, priority, reason = score_location_priority(listing, criteria)
    score += location_score

    if result.accepted and not any(note in CRITICAL_REVIEW_NOTES for note in result.review_notes):
        score += 10
    elif result.accepted:
        score += 3

    return max(0, min(score, 100)), priority, reason


def has_desired_floor(listing: Listing, criteria: dict) -> bool:
    text = f"{listing.title} {listing.text} {listing.floor or ''}"
    return any(term_in_text(text, term) for term in criteria.get("desired_floor_terms", []))


def score_location_priority(listing: Listing, criteria: dict) -> tuple[int, str, str]:
    text = f"{listing.title} {listing.text} {listing.location or ''}"
    groups = criteria.get("location_priority_terms", {}) or {}
    priorities = (
        ("high", "hoch", 30),
        ("medium", "mittel", 18),
        ("low", "weiter weg", 8),
    )
    for group, label, points in priorities:
        terms = groups.get(group, []) or []
        matching_terms = [term for term in terms if term_in_text(text, term)]
        if matching_terms:
            return points, label, ", ".join(matching_terms[:3])

    allowed_terms = criteria.get("allowed_location_terms", []) or []
    matching_allowed = [term for term in allowed_terms if term_in_text(text, term)]
    if matching_allowed:
        return 5, "normal", ", ".join(matching_allowed[:3])
    return 0, "unklar", "Ort aus Inserat pruefen"


def should_fail_run(errors: list[str], successful_sources: int) -> bool:
    return bool(errors) and successful_sources == 0


def format_report(
    matches: list[tuple[Listing, MatchResult]],
    floor_review_matches: list[tuple[Listing, MatchResult]],
    errors: list[str],
    criteria: dict | None = None,
) -> str:
    criteria = criteria or {}
    today = datetime.now(ZoneInfo("Europe/Berlin")).strftime("%Y-%m-%d %H:%M")
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
            lines.append(
                f"Legende: {NEW_LISTING_MARKER} passt gut, "
                f"{REVIEW_LISTING_MARKER} Details pruefen."
            )
            lines.append("")
            lines.extend(format_summary_table(matches, floor_review_matches, criteria))
            lines.append("")
            for index, (listing, result) in enumerate(matches, start=1):
                lines.extend(
                    format_listing(
                        index,
                        listing,
                        result,
                        review_candidate=False,
                        criteria=criteria,
                    )
                )
                lines.append("")

        if floor_review_matches:
            if not matches:
                lines.append(
                    f"Legende: {NEW_LISTING_MARKER} passt gut, "
                    f"{REVIEW_LISTING_MARKER} Details pruefen."
                )
                lines.append("")
                lines.extend(format_summary_table(matches, floor_review_matches, criteria))
                lines.append("")

            lines.append("## Pruefkandidaten: Details pruefen")
            lines.append("")
            lines.append(
                "Diese Wohnungen koennen interessant sein, brauchen aber vor einer Anfrage "
                "noch einen kurzen Blick auf Etage, Warmmiete, Groesse oder Lage."
            )
            lines.append("")
            for index, (listing, result) in enumerate(floor_review_matches, start=1):
                lines.extend(
                    format_listing(
                        index,
                        listing,
                        result,
                        review_candidate=True,
                        criteria=criteria,
                    )
                )
                lines.append("")

    if errors:
        lines.append("## Quellen mit Fehlern")
        lines.append("")
        for error in errors:
            lines.append(f"- {error}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def format_summary_table(
    matches: list[tuple[Listing, MatchResult]],
    review_matches: list[tuple[Listing, MatchResult]],
    criteria: dict,
) -> list[str]:
    rows = matches + review_matches
    if not rows:
        return []

    lines = [
        "## Schnelluebersicht",
        "",
        "| Typ | Prioritaet | Score | Ort | Preis | Groesse | Etage | Titel |",
        "| --- | --- | ---: | --- | --- | --- | --- | --- |",
    ]
    for listing, result in rows:
        review_candidate = (listing, result) in review_matches
        marker = REVIEW_LISTING_MARKER if review_candidate else NEW_LISTING_MARKER
        score, priority, _ = score_listing(listing, result, criteria)
        price = f"{listing.price_eur:g} EUR" if listing.price_eur is not None else "offen"
        area = f"{listing.area_sqm:g} qm" if listing.area_sqm is not None else "offen"
        floor = listing.floor or "pruefen"
        location = listing.location or "pruefen"
        title = markdown_table_cell(listing.title, max_length=54)
        url = listing.url.replace(")", "%29")
        lines.append(
            "| "
            f"{marker} | {priority} | {score} | "
            f"{markdown_table_cell(location, 28)} | {price} | {area} | "
            f"{markdown_table_cell(floor, 18)} | [{title}]({url}) |"
        )
    return lines


def markdown_table_cell(value: str, max_length: int) -> str:
    value = " ".join((value or "").split()).replace("|", "/")
    if len(value) > max_length:
        value = value[: max_length - 3].rstrip(" -,.") + "..."
    return value


def format_listing(
    index: int,
    listing: Listing,
    result: MatchResult,
    review_candidate: bool,
    criteria: dict | None = None,
) -> list[str]:
    criteria = criteria or {}
    price = f"{listing.price_eur:g} EUR" if listing.price_eur is not None else "Miete offen"
    area = f"{listing.area_sqm:g} qm" if listing.area_sqm is not None else "Flaeche offen"
    rooms = f"{listing.rooms:g} Zimmer" if listing.rooms is not None else "Zimmer offen"
    location = listing.location or "Lage aus Inserat pruefen"
    floor = listing.floor or "Etage pruefen"
    notes = ", ".join(result.review_notes) if result.review_notes else "keine"
    reasons = ", ".join(result.reasons) if result.reasons else "Kriterien teilweise im Text erkannt"
    score, priority, priority_reason = score_listing(listing, result, criteria)

    reason_label = "Warum nicht perfekt" if review_candidate else "Warum passend"
    marker = REVIEW_LISTING_MARKER if review_candidate else NEW_LISTING_MARKER
    lines = [
        f"### {marker} {index}. {listing.title}",
        "",
        f"- Quelle: {listing.source_name}",
        f"- Prioritaet: {priority} ({priority_reason}), Score: {score}/100",
        f"- Preis: {price}",
        f"- Groesse/Zimmer: {area}, {rooms}",
        f"- Etage: {floor}",
        f"- Lage: {location}",
        f"- {reason_label}: {reasons}",
        f"- Bitte pruefen: {notes}",
        f"- Link: {listing.url}",
    ]
    lines.extend(format_rating_section())
    return lines


def format_rating_section() -> list[str]:
    lines = [
        "",
        "<details>",
        "<summary>Bewertung anklicken</summary>",
        "",
        "Bitte pro Person genau ein Feld markieren. Zum Aendern die alte Auswahl abwaehlen.",
        "",
    ]
    for user, color, marker in RATING_PEOPLE:
        lines.append(f"**{marker} {user} ({color})**")
        lines.extend(f"- [ ] {choice}" for choice in RATING_CHOICES)
        lines.append("")
    lines.append("</details>")
    return lines


def write_reports(
    report_path: Path,
    markdown: str,
    report_entries: list[tuple[Listing, MatchResult]] | None = None,
    criteria: dict | None = None,
) -> list[Path]:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(markdown, encoding="utf-8")
    written_paths = [report_path]

    if report_entries:
        history_path = report_path.parent / "history.md"
        append_history(history_path, report_entries, criteria or {})
        written_paths.append(history_path)

    archive_dir = report_path.parent / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    archive_path = archive_dir / f"{stamp}.md"
    archive_path.write_text(markdown, encoding="utf-8")
    written_paths.append(archive_path)
    return written_paths


def append_history(
    history_path: Path,
    entries: list[tuple[Listing, MatchResult]],
    criteria: dict,
) -> None:
    history_path.parent.mkdir(parents=True, exist_ok=True)
    existing = history_path.read_text(encoding="utf-8") if history_path.exists() else ""
    seen_urls = {listing.url for listing, _ in entries if listing.url and listing.url in existing}
    lines: list[str] = []
    if not existing:
        lines.extend(
            [
                "# Verlauf gefundener Wohnungen",
                "",
                "| Erst gesehen | Typ | Prioritaet | Score | Ort | Preis | Groesse | Zimmer | Quelle | Titel |",
                "| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |",
            ]
        )

    now = datetime.now(ZoneInfo("Europe/Berlin")).strftime("%Y-%m-%d %H:%M")
    for listing, result in entries:
        if listing.url in seen_urls:
            continue
        score, priority, _ = score_listing(listing, result, criteria)
        typ = REVIEW_LISTING_MARKER if should_show_as_review_candidate(result, criteria) else NEW_LISTING_MARKER
        price = f"{listing.price_eur:g} EUR" if listing.price_eur is not None else "offen"
        area = f"{listing.area_sqm:g} qm" if listing.area_sqm is not None else "offen"
        rooms = f"{listing.rooms:g}" if listing.rooms is not None else "offen"
        location = markdown_table_cell(listing.location or "pruefen", 28)
        title = markdown_table_cell(listing.title, 60)
        url = listing.url.replace(")", "%29")
        lines.append(
            "| "
            f"{now} | {typ} | {priority} | {score} | {location} | "
            f"{price} | {area} | {rooms} | "
            f"{markdown_table_cell(listing.source_name, 32)} | [{title}]({url}) |"
        )

    if not lines:
        return

    separator = "" if not existing or existing.endswith("\n") else "\n"
    history_path.write_text(existing + separator + "\n".join(lines) + "\n", encoding="utf-8")


def append_step_summary(markdown: str) -> None:
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    with open(summary_path, "a", encoding="utf-8") as handle:
        handle.write(markdown)
        handle.write("\n")


def print_markdown(markdown: str) -> None:
    output = markdown if markdown.endswith("\n") else f"{markdown}\n"
    try:
        sys.stdout.write(output)
    except UnicodeEncodeError:
        encoding = sys.stdout.encoding or "utf-8"
        fallback = output.encode(encoding, errors="replace").decode(encoding)
        sys.stdout.write(fallback)


if __name__ == "__main__":
    raise SystemExit(main())
