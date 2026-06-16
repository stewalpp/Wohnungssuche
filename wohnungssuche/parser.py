from __future__ import annotations

import re
from urllib.parse import urljoin

import feedparser
from bs4 import BeautifulSoup

from .models import Listing


PRICE_RE = re.compile(
    r"(?<!\w)(\d{1,3}(?:[.\s]\d{3})*|\d{2,5})(?:[,.](\d{1,2}))?\s*(?:\u20ac|eur)",
    re.IGNORECASE,
)
AREA_RE = re.compile(r"(\d+(?:[,.]\d+)?)\s*(?:m(?:2|\u00b2)|qm)\b", re.IGNORECASE)
ROOMS_RE = re.compile(
    r"(\d+(?:[,.]\d+)?)\s*-?\s*(?:zi\.?|zimmer|raeume|raeumen|raum)\b",
    re.IGNORECASE,
)
FLOOR_TERM_RE = re.compile(
    r"\b(eg|erdgeschoss|parterre|hochparterre|souterrain|dg|dachgeschoss|\d+\.\s*geschoss)\b",
    re.IGNORECASE,
)
FLOOR_AFTER_WORD_RE = re.compile(r"\bgeschoss\s*(\d+)(?:\s*/\s*\d+)?\b", re.IGNORECASE)
LOCATION_RE = re.compile(
    r"\b(30\d{3}|31\d{3})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-\s]{2,35})"
)


def parse_decimal(value: str) -> float:
    normalized = value.replace(" ", "").replace(".", "").replace(",", ".")
    return float(normalized)


def parse_price(text: str) -> float | None:
    for match in PRICE_RE.finditer(text):
        tail = text[match.end() : match.end() + 8].lower()
        if "/m" in tail or "pro m" in tail:
            continue
        whole, cents = match.groups()
        prefix = text[max(0, match.start() - 6) : match.start()]
        if "/" in prefix and " " in whole and "." not in whole:
            whole = whole.split()[-1]
        value = parse_decimal(f"{whole},{cents}" if cents else whole)
        if 50 <= value <= 10000:
            return value
    return None


def parse_area(text: str) -> float | None:
    match = AREA_RE.search(text)
    return parse_decimal(match.group(1)) if match else None


def parse_rooms(text: str) -> float | None:
    match = ROOMS_RE.search(text)
    return parse_decimal(match.group(1)) if match else None


def parse_floor(text: str) -> str | None:
    match = FLOOR_TERM_RE.search(text)
    if match:
        return " ".join(match.group(1).lower().split())
    match = FLOOR_AFTER_WORD_RE.search(text)
    if match:
        return f"{int(match.group(1))}. geschoss"
    return None


def parse_location(text: str) -> str | None:
    match = LOCATION_RE.search(text)
    if match:
        return " ".join(match.group(0).split())
    return None


def clean_title(title: str, text: str = "") -> str:
    value = " ".join((title or "").split()) or " ".join((text or "").split())
    start = re.search(
        r"\b(?:wohnung|terrassenwohnung|maisonette|tauschwohnung|erstbezug)\b",
        value,
        re.IGNORECASE,
    )
    if start:
        value = value[start.start() :]

    stop = re.search(
        r"\s+(?:frei\s+ab|die\s+wohnung|es\s+h|kaltmiete|warmmiete)\b",
        value,
        re.IGNORECASE,
    )
    if stop:
        value = value[: stop.start()]

    value = re.sub(
        r"^(?:\d+\s*/\s*\d+\s*)?(?:neu\s*)?(?:[a-h]\+?\s*)?",
        "",
        value,
        flags=re.IGNORECASE,
    )
    value = re.sub(r"\bm\s*(?:2|\u00b2)\b", "qm", value, flags=re.IGNORECASE)
    value = re.sub(r"\s*(?:[|]|\u00b7)\s*", ", ", value)
    value = re.sub(r"\s+", " ", value).strip(" -,.")
    if len(value) > 95:
        value = value[:92].rstrip(" -,.") + "..."
    return value or "(ohne Titel)"


def parse_rss(content: bytes, source: dict) -> list[Listing]:
    feed = feedparser.parse(content)
    listings: list[Listing] = []
    for entry in feed.entries:
        title = getattr(entry, "title", "") or ""
        summary = getattr(entry, "summary", "") or ""
        link = getattr(entry, "link", "") or ""
        text = BeautifulSoup(f"{title} {summary}", "html.parser").get_text(" ", strip=True)
        listings.append(build_listing(source["name"], title, link, text))
    return listings


def parse_html(content: bytes, source: dict) -> list[Listing]:
    base_url = source.get("url", "")
    soup = BeautifulSoup(content, "html.parser")
    selectors = source.get("selectors") or {}
    if selectors.get("listing"):
        return parse_html_with_selectors(soup, source, selectors, base_url)
    return parse_html_generic(soup, source, base_url)


def parse_html_with_selectors(
    soup: BeautifulSoup, source: dict, selectors: dict, base_url: str
) -> list[Listing]:
    listings: list[Listing] = []
    for item in soup.select(selectors["listing"]):
        link_node = item.select_one(selectors.get("url", "a[href]"))
        if not link_node or not link_node.get("href"):
            continue
        title_node = item.select_one(selectors.get("title", "a[href]"))
        text = item.get_text(" ", strip=True)
        title = title_node.get_text(" ", strip=True) if title_node else text[:120]
        url = urljoin(base_url, link_node["href"])
        listings.append(build_listing(source["name"], title, url, text))
    return unique_listings(listings)


def parse_html_generic(soup: BeautifulSoup, source: dict, base_url: str) -> list[Listing]:
    listings: list[Listing] = []
    for anchor in soup.select("a[href]"):
        href = anchor.get("href", "")
        url = urljoin(base_url, href)
        if not looks_like_listing_url(url):
            continue

        card = nearest_card(anchor)
        text = card.get_text(" ", strip=True) if card else anchor.get_text(" ", strip=True)
        title = anchor.get_text(" ", strip=True) or text[:120]
        if not looks_like_listing_text(text, url):
            continue
        listings.append(build_listing(source["name"], title, url, text))
    return unique_listings(listings)


def nearest_card(anchor) -> object | None:
    node = anchor
    best = anchor
    for _ in range(4):
        parent = getattr(node, "parent", None)
        if parent is None:
            break
        text = parent.get_text(" ", strip=True)
        if 40 <= len(text) <= 1200:
            best = parent
        node = parent
    return best


def looks_like_listing_url(url: str) -> bool:
    lowered = url.lower()
    if "immowelt.de" in lowered or "immobilienscout24.de" in lowered:
        return "/expose/" in lowered or "/expose" in lowered
    if "kleinanzeigen.de" in lowered:
        return "/s-anzeige/" in lowered
    return any(
        part in lowered
        for part in (
            "/expose/",
            "/expose",
            "/angebot/",
            "/s-anzeige/",
        )
    )


def looks_like_listing_text(text: str, url: str) -> bool:
    lowered = f"{text} {url}".lower()
    if "gesuch" in lowered and "wohnung" not in lowered:
        return False
    has_listing_word = any(word in lowered for word in ("wohnung", "miete", "zimmer", "expose"))
    structured_hits = sum(
        value is not None for value in (parse_price(text), parse_area(text), parse_rooms(text))
    )
    return has_listing_word and structured_hits >= 2


def build_listing(source_name: str, title: str, url: str, text: str) -> Listing:
    full_text = " ".join([title or "", text or ""]).strip()
    return Listing(
        source_name=source_name,
        title=clean_title(title, text),
        url=url,
        text=full_text,
        price_eur=parse_price(full_text),
        area_sqm=parse_area(full_text),
        rooms=parse_rooms(full_text),
        location=parse_location(full_text),
        floor=parse_floor(full_text),
    )


def unique_listings(listings: list[Listing]) -> list[Listing]:
    seen: set[str] = set()
    unique: list[Listing] = []
    for listing in listings:
        if listing.id in seen:
            continue
        seen.add(listing.id)
        unique.append(listing)
    return unique
