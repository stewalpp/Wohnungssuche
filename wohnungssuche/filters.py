from __future__ import annotations

import unicodedata
import re
from dataclasses import dataclass

from .models import Listing


@dataclass(slots=True)
class MatchResult:
    accepted: bool
    reasons: list[str]
    review_notes: list[str]


def normalize_text(value: str) -> str:
    value = value or ""
    for source, replacement in {
        "\u00e4": "ae",
        "\u00f6": "oe",
        "\u00fc": "ue",
        "\u00df": "ss",
        "\u00c4": "ae",
        "\u00d6": "oe",
        "\u00dc": "ue",
    }.items():
        value = value.replace(source, replacement)
    for source, replacement in {
        "ä": "ae",
        "ö": "oe",
        "ü": "ue",
        "ß": "ss",
        "Ä": "ae",
        "Ö": "oe",
        "Ü": "ue",
    }.items():
        value = value.replace(source, replacement)
    normalized = unicodedata.normalize("NFKD", value)
    return normalized.encode("ascii", "ignore").decode("ascii").lower()


def contains_any(text: str, terms: list[str], *, word_boundary: bool = False) -> bool:
    return any(term_in_text(text, term, word_boundary=word_boundary) for term in terms)


def find_terms(text: str, terms: list[str], *, word_boundary: bool = False) -> list[str]:
    return [term for term in terms if term_in_text(text, term, word_boundary=word_boundary)]


def term_in_text(text: str, term: str, *, word_boundary: bool = False) -> bool:
    normalized = normalize_text(text)
    normalized_term = normalize_text(term)
    if not normalized_term:
        return False
    if any(not (character.isalnum() or character.isspace()) for character in normalized_term):
        return normalized_term in normalized
    # Word-boundary matching for short/multi-word terms always; and for ALL terms
    # when the caller asks (location names), so e.g. excluded "haste" no longer
    # hard-rejects a flat whose prose contains "hasten", and allowed "stemmen"
    # doesn't match "abstemmen". Product/feature exclusions keep substring matching
    # (so compounds like "Altbauwohnung" still hit "altbau").
    if word_boundary or len(normalized_term) <= 3 or " " in normalized_term:
        pattern = rf"(?<![a-z0-9]){re.escape(normalized_term)}(?![a-z0-9])"
        return re.search(pattern, normalized) is not None
    return normalized_term in normalized


def effective_total_rent(listing: Listing) -> float | None:
    """Best estimate of the WARM (total) rent, or None if it can't be derived.

    Prefers a stated Warmmiete; else sums Kaltmiete (or the generic price) with
    the stated Nebenkosten/Heizkosten; returns None when only the cold rent is
    known (the total is genuinely unknown then).
    """
    if listing.warmmiete_eur is not None:
        return listing.warmmiete_eur
    base = listing.kaltmiete_eur if listing.kaltmiete_eur is not None else listing.price_eur
    if base is None:
        return None
    extras = (listing.nebenkosten_eur or 0) + (listing.heizkosten_eur or 0)
    return base + extras if extras > 0 else None


def evaluate_listing(listing: Listing, criteria: dict) -> MatchResult:
    reasons: list[str] = []
    review_notes: list[str] = []
    text = f"{listing.title} {listing.text} {listing.location or ''}"

    excluded = find_terms(text, criteria.get("excluded_terms", []))
    if excluded:
        return MatchResult(False, [f"ausgeschlossen: {', '.join(excluded)}"], review_notes)

    excluded_locations = find_terms(text, criteria.get("excluded_location_terms", []), word_boundary=True)
    if excluded_locations:
        return MatchResult(
            False,
            [f"ausgeschlossen: Ort ausserhalb Suchgebiet ({', '.join(excluded_locations)})"],
            review_notes,
        )

    min_rooms = criteria.get("min_rooms")
    if listing.rooms is None:
        review_notes.append("Zimmerzahl pruefen")
    elif min_rooms is not None and listing.rooms < float(min_rooms):
        return MatchResult(False, [f"zu wenig Zimmer: {listing.rooms:g}"], review_notes)
    else:
        reasons.append(f"{listing.rooms:g} Zimmer")

    min_area = criteria.get("min_area_sqm")
    if listing.area_sqm is None:
        review_notes.append("Wohnflaeche pruefen")
    elif min_area is not None and listing.area_sqm < float(min_area):
        return MatchResult(False, [f"zu klein: {listing.area_sqm:g} qm"], review_notes)
    else:
        reasons.append(f"{listing.area_sqm:g} qm")

    max_rent = criteria.get("max_total_rent_eur")
    total = effective_total_rent(listing)
    base = listing.kaltmiete_eur if listing.kaltmiete_eur is not None else listing.price_eur
    if max_rent is None:
        if total is not None:
            reasons.append(f"{total:g} EUR warm")
        elif base is not None:
            reasons.append(f"{base:g} EUR")
        else:
            review_notes.append("Miete und Nebenkosten pruefen")
    else:
        max_rent = float(max_rent)
        if total is not None:
            # Warm rent is known → enforce the cap on the real total.
            if total > max_rent:
                return MatchResult(False, [f"zu teuer: {total:g} EUR warm"], review_notes)
            reasons.append(f"{total:g} EUR warm")
        elif base is not None:
            # Only the cold rent is known. Reject if the cold rent alone already
            # exceeds the cap; flag for review when it's close enough that the
            # (unknown) warm rent likely tips over; accept when comfortably under.
            if base > max_rent:
                return MatchResult(False, [f"zu teuer: {base:g} EUR"], review_notes)
            if base + 250 > max_rent:
                review_notes.append("Miete und Nebenkosten pruefen")
            reasons.append(f"{base:g} EUR kalt")
        else:
            review_notes.append("Miete und Nebenkosten pruefen")

    location_terms = criteria.get("allowed_location_terms", [])
    if location_terms and not contains_any(text, location_terms, word_boundary=True):
        # A town-pinned source URL (e.g. "Kleinanzeigen Gehrden") guarantees the
        # area even when the card text omits the town name — don't hard-reject it.
        source_in_area = contains_any(listing.source_name or "", location_terms, word_boundary=True)
        if source_in_area:
            review_notes.append("Ort im Inserat pruefen")
        elif criteria.get("strict_location", False):
            return MatchResult(
                False,
                ["Lage nicht im Suchgebiet erkannt"],
                review_notes,
            )
        else:
            review_notes.append("Lage im Suchgebiet pruefen")

    if criteria.get("require_ground_floor", False):
        floor_terms = criteria.get("desired_floor_terms", [])
        if contains_any(text, floor_terms):
            reasons.append("EG/Parterre-Hinweis gefunden")
        elif listing.floor:
            return MatchResult(False, [f"kein EG/Parterre: {listing.floor}"], review_notes)
        elif not criteria.get("allow_unknown_floor", True):
            return MatchResult(False, ["Etage nicht erkennbar"], review_notes)
        else:
            review_notes.append("Etage pruefen")

    for term in criteria.get("review_terms", []):
        if not contains_any(text, [term]):
            continue
        review_notes.append(f"{term} pruefen")

    return MatchResult(True, reasons, sorted(set(review_notes)))
