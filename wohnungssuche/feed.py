from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

from .filters import MatchResult, normalize_text
from .models import Listing


# The PWA (docs/) fetches this file relative to the GitHub Pages site root.
DEFAULT_FEED_PATH = Path("docs/data/listings.json")

# Schema version of the JSON the app consumes. Bump when the shape changes so
# the client can react to (or warn about) incompatible feeds.
FEED_SCHEMA = 1

# Upper bound on listings written to the feed; the most recently seen survive.
# Keeps the committed JSON small even after months of searching.
FEED_LIMIT = 300

# Listings not seen in the search for this long are dropped from the feed, so a
# flaky source (whose listings never get marked "unavailable") can't leave stale
# apartments showing as available forever.
FEED_MAX_AGE_DAYS = 21

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
        entry["title"] = listing.title or entry.get("title", "")
        entry["url"] = listing.url or entry.get("url", "")
        set_if_present(entry, "price_eur", listing.price_eur)
        set_if_present(entry, "area_sqm", listing.area_sqm)
        set_if_present(entry, "rooms", listing.rooms)
        set_if_present(entry, "location", listing.location)
        set_if_present(entry, "floor", listing.floor)
        if listing.image:
            entry["image"] = listing.image
        if listing.images:
            entry["images"] = list(listing.images)
        # Cost components parsed from the listing (only set when actually stated).
        set_if_present(entry, "kaltmiete_eur", listing.kaltmiete_eur)
        set_if_present(entry, "nebenkosten_eur", listing.nebenkosten_eur)
        set_if_present(entry, "heizkosten_eur", listing.heizkosten_eur)
        set_if_present(entry, "warmmiete_eur", listing.warmmiete_eur)
        # Mark that we've attempted to capture cost data, so already-seen listings
        # aren't re-fetched from their detail page on every run.
        entry["cost_checked"] = True
        entry["match_status"] = MATCH_STATUS if result.accepted else REVIEW_STATUS
        entry["reasons"] = list(result.reasons)
        entry["review_notes"] = list(result.review_notes)
        entry["last_seen_in_search"] = now_iso
        # Revive a relisted apartment with the same bookkeeping the weekly
        # availability check uses, so its status stays consistent.
        previous_status = entry.get("availability_status")
        entry["availability_status"] = "available"
        if previous_status == STATUS_UNAVAILABLE:
            entry["status_changed_at"] = now_iso
            entry.pop("last_missing_from_search", None)
            # Leave a breadcrumb for the weekly availability check. The daily run
            # has just flipped this back to "available", so the weekly previous→new
            # diff would otherwise see no change and never report the relist. The
            # weekly run consumes (pops) this flag and emits the "wieder sichtbar"
            # change/notification.
            entry["relisted_at"] = now_iso


def set_if_present(entry: dict, key: str, value: object | None) -> None:
    if value is not None:
        entry[key] = value
    elif key not in entry:
        entry[key] = None


def _parse_dt(value: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _item_fingerprint(item: dict) -> str:
    """Content fingerprint for a feed item, to collapse the same flat that is
    syndicated across portals under different URLs/ids. Empty when key fields are
    missing (then the item is never deduped)."""
    price, area, rooms = item.get("price_eur"), item.get("area_sqm"), item.get("rooms")
    if price is None or area is None or rooms is None:
        return ""
    location = normalize_text(item.get("location") or item.get("title") or "")
    title = normalize_text(item.get("title") or "")
    title_words = " ".join(word for word in title.split() if len(word) > 3)[:50]
    return "|".join([
        str(round(float(price))),
        str(round(float(area))),
        str(round(float(rooms) * 10) / 10),
        location[:60],
        title_words,
    ])


def _better_item(a: dict, b: dict) -> bool:
    """True if feed item ``a`` should replace ``b`` for the same fingerprint:
    a real match beats a review candidate; otherwise the more recently seen wins."""
    if a.get("status") != b.get("status"):
        return a.get("status") == MATCH_STATUS
    return (a.get("last_seen") or "") > (b.get("last_seen") or "")


def build_feed(state: dict, criteria: dict, generated_at: str) -> dict:
    """Build the JSON payload the app consumes from the cumulative seen-state.

    Only entries enriched by :func:`record_listings` (those with a
    ``match_status``), not marked ``unavailable`` and seen within the last
    ``FEED_MAX_AGE_DAYS`` days are included, newest listing first.
    """
    seen = state.get("seen", {})
    generated_dt = _parse_dt(generated_at)
    cutoff = generated_dt - timedelta(days=FEED_MAX_AGE_DAYS) if generated_dt else None

    listings: list[dict] = []
    for listing_id, entry in seen.items():
        if entry.get("match_status") not in (MATCH_STATUS, REVIEW_STATUS):
            continue
        if entry.get("availability_status") == STATUS_UNAVAILABLE:
            continue
        last_seen = entry.get("last_seen_in_search") or entry.get("first_seen", "")
        if cutoff is not None:
            last_seen_dt = _parse_dt(last_seen)
            if last_seen_dt is not None:
                try:
                    if last_seen_dt < cutoff:
                        continue
                except TypeError:
                    pass  # mixed naive/aware timestamps — keep rather than wrongly drop
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
                "image": entry.get("image"),
                "images": entry.get("images")
                or ([entry.get("image")] if entry.get("image") else []),
                "kaltmiete_eur": entry.get("kaltmiete_eur"),
                "nebenkosten_eur": entry.get("nebenkosten_eur"),
                "heizkosten_eur": entry.get("heizkosten_eur"),
                "warmmiete_eur": entry.get("warmmiete_eur"),
                "status": entry.get("match_status"),
                "reasons": entry.get("reasons", []),
                "review_notes": entry.get("review_notes", []),
                "first_seen": entry.get("first_seen", ""),
                "last_seen": last_seen,
            }
        )

    # Collapse the same flat syndicated across portals (different URLs/ids but
    # identical price/area/rooms/location/title), keeping the match over a review
    # candidate and otherwise the most recently seen entry.
    by_fp: dict[str, dict] = {}
    deduped: list[dict] = []
    for item in listings:
        fingerprint = _item_fingerprint(item)
        if not fingerprint:
            deduped.append(item)
            continue
        previous = by_fp.get(fingerprint)
        if previous is None:
            by_fp[fingerprint] = item
            deduped.append(item)
        elif _better_item(item, previous):
            deduped[deduped.index(previous)] = item
            by_fp[fingerprint] = item
    listings = deduped

    # Cap by most-recently-seen so currently-active listings are never evicted in
    # favour of staler ones still under the cap; then present newest listing first
    # (matches the app's default "Neueste zuerst" sort).
    listings.sort(key=lambda item: (item["last_seen"], item["id"]), reverse=True)
    listings = listings[:FEED_LIMIT]
    listings.sort(key=lambda item: (item["first_seen"], item["id"]), reverse=True)

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
