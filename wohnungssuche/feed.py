from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlsplit

from .filters import MatchResult
from .models import Listing


# The PWA (docs/) fetches this file relative to the GitHub Pages site root.
DEFAULT_FEED_PATH = Path("docs/data/listings.json")

# Schema version of the JSON the app consumes. Bump when the shape changes so
# the client can react to (or warn about) incompatible feeds.
FEED_SCHEMA = 1

# Upper bound on listings written to the feed; the newest survive. Keeps the
# committed JSON small even after months of searching.
FEED_LIMIT = 300

STATUS_UNAVAILABLE = "unavailable"

MATCH_STATUS = "match"
REVIEW_STATUS = "review"


def portal_from_url(url: str) -> str:
    """Coarse portal key derived from the listing host (for icon/colour in the app)."""
    host = urlsplit(url or "").netloc.lower()
    if "immowelt" in host:
        return "immowelt"
    if "immobilienscout24" in host or "immoscout" in host:
        return "immoscout24"
    if "kleinanzeigen" in host:
        return "kleinanzeigen"
    if "wohnungsboerse" in host:
        return "wohnungsboerse"
    if "immobilo" in host:
        return "immobilo"
    return host or "unbekannt"


def record_listings(
    state: dict,
    feed_candidates: list[tuple[Listing, MatchResult]],
    now_iso: str,
) -> None:
    """Upsert full listing data into the seen-state for every feed-eligible listing.

    Preserves ``first_seen`` and any availability metadata written by the weekly
    check, refreshes the descriptive fields, and revives a relisted apartment by
    resetting it to ``available``. Must run AFTER the report's seen-filtering so
    the GitHub-issue notifications are unaffected.
    """
    seen = state.setdefault("seen", {})
    for listing, result in feed_candidates:
        entry = seen.get(listing.id)
        if entry is None:
            entry = {"first_seen": now_iso}
            seen[listing.id] = entry

        entry["source"] = listing.source_name
        entry["title"] = listing.title
        entry["url"] = listing.url
        entry["price_eur"] = listing.price_eur
        entry["area_sqm"] = listing.area_sqm
        entry["rooms"] = listing.rooms
        entry["location"] = listing.location
        entry["floor"] = listing.floor
        entry["match_status"] = MATCH_STATUS if result.accepted else REVIEW_STATUS
        entry["reasons"] = list(result.reasons)
        entry["review_notes"] = list(result.review_notes)
        entry["last_seen_in_search"] = now_iso
        entry["availability_status"] = "available"


def build_feed(state: dict, criteria: dict, generated_at: str) -> dict:
    """Build the JSON payload the app consumes from the cumulative seen-state.

    Only entries enriched by :func:`record_listings` (those with a
    ``match_status``) and not marked ``unavailable`` are included, newest first.
    """
    seen = state.get("seen", {})
    listings: list[dict] = []
    for listing_id, entry in seen.items():
        if entry.get("match_status") not in (MATCH_STATUS, REVIEW_STATUS):
            continue
        if entry.get("availability_status") == STATUS_UNAVAILABLE:
            continue
        listings.append(
            {
                "id": listing_id,
                "title": entry.get("title", ""),
                "url": entry.get("url", ""),
                "source": entry.get("source", ""),
                "portal": portal_from_url(entry.get("url", "")),
                "price_eur": entry.get("price_eur"),
                "area_sqm": entry.get("area_sqm"),
                "rooms": entry.get("rooms"),
                "location": entry.get("location"),
                "floor": entry.get("floor"),
                "status": entry.get("match_status"),
                "reasons": entry.get("reasons", []),
                "review_notes": entry.get("review_notes", []),
                "first_seen": entry.get("first_seen", ""),
                "last_seen": entry.get("last_seen_in_search", entry.get("first_seen", "")),
            }
        )

    listings.sort(key=lambda item: (item["first_seen"], item["id"]), reverse=True)
    listings = listings[:FEED_LIMIT]

    match_count = sum(1 for item in listings if item["status"] == MATCH_STATUS)
    review_count = sum(1 for item in listings if item["status"] == REVIEW_STATUS)

    return {
        "schema": FEED_SCHEMA,
        "generated_at": generated_at,
        "criteria": {
            "min_rooms": criteria.get("min_rooms"),
            "min_area_sqm": criteria.get("min_area_sqm"),
            "max_total_rent_eur": criteria.get("max_total_rent_eur"),
        },
        "counts": {
            "total": len(listings),
            "match": match_count,
            "review": review_count,
        },
        "listings": listings,
    }


def write_feed(path: Path, state: dict, criteria: dict, generated_at: str) -> Path:
    """Write the app feed JSON to ``path`` and return the path."""
    payload = build_feed(state, criteria, generated_at)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=False)
        handle.write("\n")
    return path
