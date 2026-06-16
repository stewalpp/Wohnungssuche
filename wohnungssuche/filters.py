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


def contains_any(text: str, terms: list[str]) -> bool:
    return any(term_in_text(text, term) for term in terms)


def find_terms(text: str, terms: list[str]) -> list[str]:
    return [term for term in terms if term_in_text(text, term)]


def term_in_text(text: str, term: str) -> bool:
    normalized = normalize_text(text)
    normalized_term = normalize_text(term)
    if not normalized_term:
        return False
    if any(not (character.isalnum() or character.isspace()) for character in normalized_term):
        return normalized_term in normalized
    if len(normalized_term) <= 3 or " " in normalized_term:
        pattern = rf"(?<![a-z0-9]){re.escape(normalized_term)}(?![a-z0-9])"
        return re.search(pattern, normalized) is not None
    return normalized_term in normalized


def evaluate_listing(listing: Listing, criteria: dict) -> MatchResult:
    reasons: list[str] = []
    review_notes: list[str] = []
    text = f"{listing.title} {listing.text} {listing.location or ''}"

    excluded = find_terms(text, criteria.get("excluded_terms", []))
    if excluded:
        return MatchResult(False, [f"ausgeschlossen: {', '.join(excluded)}"], review_notes)

    excluded_locations = find_terms(text, criteria.get("excluded_location_terms", []))
    if excluded_locations:
        return MatchResult(
            False,
            [f"ausgeschlossen: Ort ausserhalb Barsinghausen ({', '.join(excluded_locations)})"],
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
    if listing.price_eur is None:
        review_notes.append("Miete und Nebenkosten pruefen")
    elif max_rent is not None and listing.price_eur > float(max_rent):
        return MatchResult(False, [f"zu teuer: {listing.price_eur:g} EUR"], review_notes)
    else:
        reasons.append(f"{listing.price_eur:g} EUR")

    location_terms = criteria.get("allowed_location_terms", [])
    if location_terms and not contains_any(text, location_terms):
        if criteria.get("strict_location", False):
            return MatchResult(
                False,
                ["Lage nicht im Korridor Hannover-Barsinghausen erkannt"],
                review_notes,
            )
        review_notes.append("Lage im Korridor Hannover-Barsinghausen pruefen")

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
