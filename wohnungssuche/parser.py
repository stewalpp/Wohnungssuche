from __future__ import annotations

import re
from urllib.parse import unquote, urljoin, urlparse

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
    r"\b(eg|erdgeschoss|parterre|hochparterre|souterrain|dg|dachgeschoss|\d+\.?\s*(?:geschoss|og|stock))\b",
    re.IGNORECASE,
)
FLOOR_AFTER_WORD_RE = re.compile(
    r"\b(?:geschoss|og|stock)\s*(\d+)(?:\s*/\s*\d+)?\b",
    re.IGNORECASE,
)
LOCATION_RE = re.compile(
    r"\b(30\d{3}|31\d{3})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-\s]{2,35})"
)


def parse_decimal(value: str, *, dot_is_decimal: bool = False) -> float:
    v = value.replace(" ", "")
    if "," in v:
        # German convention: comma is the decimal separator, dots are thousands.
        v = v.replace(".", "").replace(",", ".")
    elif not dot_is_decimal:
        # Price context: a lone dot is a thousands separator ("1.234" -> 1234).
        v = v.replace(".", "")
    # else: no comma and dot_is_decimal -> the dot is already a decimal point
    # ("3.5 Zimmer" -> 3.5, "72.50 m2" -> 72.5), so leave it untouched.
    return float(v)


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
    return parse_decimal(match.group(1), dot_is_decimal=True) if match else None


def parse_rooms(text: str) -> float | None:
    match = ROOMS_RE.search(text)
    return parse_decimal(match.group(1), dot_is_decimal=True) if match else None


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
        value = " ".join(match.group(0).split())
        for marker in (" Immobilientyp", " Kaltmiete", " Warmmiete", " Preis", " Zimmer"):
            if marker in value:
                value = value.split(marker, 1)[0].strip()
        return value
    return None


# --- labelled cost amounts (Kaltmiete / Nebenkosten / Heizkosten / Warmmiete) ---
# A German money amount: grouped thousands (1.234 / 1 234) or plain digits, with
# an optional ",dd" decimal part. Two capturing groups: whole, cents.
_AMOUNT = r"(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d{1,2}))?"
# Currency token: a literal € (may be followed by anything) or "eur" / "euro" /
# "euros" closed by a word boundary. The optional "os?" lets the very common
# spelled-out "Euro"/"Euros" match while "europa"/"europaweit" still never count
# as euro (no word boundary after the would-be "o").
_CUR = r"(?:€|eur(?:os?)?\b)"
_AMOUNT_CUR_RE = re.compile(_AMOUNT + r"\s*" + _CUR, re.IGNORECASE)
# Per-area markers near an amount mean it's a €/m² rate, not a total to use.
_PER_AREA = ("m²", "/qm", "/m2", "pro qm", "je qm", "pro m²", "je m²")

# Cost-label markers → field key. Each occurrence is matched and every €-amount
# is assigned to its NEAREST label, so both "Nebenkosten 180 €" and "180 €
# Nebenkosten" work, and an amount between two labels goes to the closer one
# (ties favour the preceding label — the German "Label dann Betrag" norm).
_COST_LABELS = [
    ("kalt", re.compile(r"nettokaltmiete|netto\s*kaltmiete|kaltmiete|grundmiete|nettomiete|\bkalt\b", re.IGNORECASE)),
    ("neben", re.compile(r"nebenkosten|betriebskosten|neben\s*kosten|nebenkost\.?|\bnk\b", re.IGNORECASE)),
    ("heiz", re.compile(r"heizkosten|\bheizung\b", re.IGNORECASE)),
    ("warm", re.compile(r"warmmiete|warmiete|gesamtmiete|bruttomiete|brutto\s*miete|\bwarm\b", re.IGNORECASE)),
]
_COST_BOUNDS = {"kalt": (50, 10000), "neben": (1, 2500), "heiz": (1, 1500), "warm": (50, 12000)}
# How far (characters) a label may sit from its amount to still count.
_MAX_LABEL_GAP = 24


def _amount_to_float(whole: str, cents: str | None) -> float:
    digits = re.sub(r"[.\s]", "", whole)
    return float(f"{digits}.{cents}") if cents else float(digits)


def parse_cost_fields(text: str) -> dict[str, float | None]:
    """Kaltmiete/Nebenkosten/Heizkosten/Warmmiete stated in ``text`` (else None).

    Assigns each €-amount to the nearest cost label, skips €/m² rates, and keeps
    only the first plausible value per field.
    """
    result: dict[str, float | None] = {key: None for key in _COST_BOUNDS}
    labels: list[tuple[int, int, str]] = []
    for field, pattern in _COST_LABELS:
        for match in pattern.finditer(text):
            labels.append((match.start(), match.end(), field))
    if not labels:
        return result

    # Each amount is bound to its single nearest label; per field we keep the
    # CLOSEST bound amount. So in "650 € Nebenkosten 110 €" the label takes 110
    # (adjacent) and the bare 650 — nearer to no label than 110 is — drops out.
    chosen_dist: dict[str, float] = {}
    for amount in _AMOUNT_CUR_RE.finditer(text):
        vicinity = (amount.group(0) + text[amount.end() : amount.end() + 6]).lower()
        if any(marker in vicinity for marker in _PER_AREA):
            continue
        value = _amount_to_float(amount.group(1), amount.group(2))
        a_start, a_end = amount.start(), amount.end()

        best_field = None
        best_dist = None
        for l_start, l_end, field in labels:
            if l_end <= a_start:
                dist = a_start - l_end            # label before the amount
            elif l_start >= a_end:
                dist = (l_start - a_end) + 0.5     # label after → tie-break loses
            else:
                dist = 0
            if best_dist is None or dist < best_dist:
                best_field, best_dist = field, dist

        if best_field is None or best_dist > _MAX_LABEL_GAP:
            continue
        lo, hi = _COST_BOUNDS[best_field]
        if not (lo <= value <= hi):
            continue
        if best_field not in chosen_dist or best_dist < chosen_dist[best_field]:
            result[best_field] = value
            chosen_dist[best_field] = best_dist

    # Sanity: a Warmmiete below the Kaltmiete is impossible (warm = cold + extras),
    # so a "warm" amount that lost the label tug-of-war is a mis-assignment — drop it.
    if result["warm"] is not None and result["kalt"] is not None and result["warm"] < result["kalt"]:
        result["warm"] = None
    return result


def parse_kaltmiete(text: str) -> float | None:
    return parse_cost_fields(text)["kalt"]


def parse_nebenkosten(text: str) -> float | None:
    return parse_cost_fields(text)["neben"]


def parse_heizkosten(text: str) -> float | None:
    return parse_cost_fields(text)["heiz"]


def parse_warmmiete(text: str) -> float | None:
    return parse_cost_fields(text)["warm"]


def clean_title(title: str, text: str = "", url: str = "") -> str:
    value = " ".join((title or "").split())
    from_url_title = False
    if is_noisy_title(value):
        url_title = title_from_url(url)
        if url_title:
            value = url_title
            from_url_title = True
        else:
            value = " ".join((text or "").split())
    if not value:
        value = " ".join((text or "").split())
    if not from_url_title:
        start = re.search(
            r"\b(?:wohnung|terrassenwohnung|maisonette|tauschwohnung|erstbezug)\b",
            value,
            re.IGNORECASE,
        )
        if start:
            value = value[start.start() :]

        stop = re.search(
            r"\s+(?:frei\s+ab|die\s+wohnung|es\s+h|merken\s+anzeige|quelle:|kaltmiete|warmmiete)\b",
            value,
            re.IGNORECASE,
        )
        if stop:
            value = value[: stop.start()]

    if not from_url_title:
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


def is_noisy_title(title: str) -> bool:
    if not title:
        return True
    normalized = " ".join(title.split())
    if re.fullmatch(r"(?:www\.)?[a-z0-9-]+\.[a-z]{2,}", normalized, re.IGNORECASE):
        return True
    if re.fullmatch(r"\d+(?:\s*/\s*\d+)?", normalized):
        return True
    return re.fullmatch(r"\d{5}\s+[A-Za-zÃ„Ã–ÃœÃ¤Ã¶Ã¼ÃŸ\-\s]{2,35}", normalized) is not None


def title_from_url(url: str) -> str:
    path = unquote(urlparse(url).path)
    match = re.search(r"/s-anzeige/([^/]+)/", path)
    if not match:
        return ""
    slug = match.group(1).strip("-")
    value = " ".join(part for part in slug.split("-") if part)
    replacements = {
        "ae": "ae",
        "oe": "oe",
        "ue": "ue",
        "zi": "Zi",
        "zimmer": "Zimmer",
        "wohnung": "Wohnung",
        "einbaukueche": "Einbaukueche",
        "bad": "Bad",
        "nenndorf": "Nenndorf",
        "rodenberg": "Rodenberg",
        "haste": "Haste",
        "sonnige": "Sonnige",
        "maisonette": "Maisonette",
        "wohnug": "Wohnung",
    }
    words = [format_slug_word(word, replacements) for word in value.split()]
    return " ".join(words).strip()


def format_slug_word(word: str, replacements: dict[str, str]) -> str:
    lowered = word.lower()
    if lowered in replacements:
        return replacements[lowered]
    if any(character.isdigit() for character in word):
        return word
    if lowered in {"ab", "als", "am", "im", "in", "mit", "und", "von", "zur"}:
        return lowered
    return word[:1].upper() + word[1:]


def parse_rss(content: bytes, source: dict) -> list[Listing]:
    feed = feedparser.parse(content)
    listings: list[Listing] = []
    for entry in feed.entries:
        title = getattr(entry, "title", "") or ""
        summary = getattr(entry, "summary", "") or ""
        link = getattr(entry, "link", "") or ""
        text = BeautifulSoup(f"{title} {summary}", "html.parser").get_text(" ", strip=True)
        images = images_from_rss_entry(entry, summary)
        listings.append(build_listing(source["name"], title, link, text, images=images))
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
        images = extract_images(item, base_url)
        listings.append(build_listing(source["name"], title, url, text, images=images))
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
        images = extract_images(card, base_url)
        listings.append(build_listing(source["name"], title, url, text, images=images))
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
    if "wohnungsboerse.net" in lowered:
        return "/immodetail/" in lowered
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


IMAGE_SKIP_RE = re.compile(
    r"logo|sprite|icon|placeholder|blank|pixel|spacer|base64", re.IGNORECASE
)
IMAGE_ATTRS = ("src", "data-src", "data-imgsrc", "data-original", "data-lazy-src")


def first_url_from_srcset(value: str) -> str:
    first = value.split(",", 1)[0].strip()
    return first.split(" ", 1)[0].strip() if first else ""


def extract_images(node, base_url: str, limit: int = 8) -> list[str]:
    """All usable listing photo URLs within a card/item (de-duplicated, capped).

    Same filtering as a single thumbnail (handles lazy-loaded data-* / srcset
    attributes, skips logos/sprites/placeholders) but returns every distinct
    photo so the app can show a gallery. URLs are de-duplicated by their path
    (ignoring the query string) so size variants of one photo don't repeat.
    Returns absolute http(s) URLs; the first entry equals what a single-image
    extraction would yield, so one-photo behaviour is unchanged.
    """
    if node is None:
        return []
    images: list[str] = []
    seen: set[str] = set()
    for img in node.find_all("img"):
        candidates: list[str] = []
        for attr in IMAGE_ATTRS:
            value = img.get(attr)
            if value:
                candidates.append(value)
        for attr in ("srcset", "data-srcset"):
            value = img.get(attr)
            if value:
                candidates.append(first_url_from_srcset(value))
        for candidate in candidates:
            if not candidate or candidate.startswith("data:"):
                continue
            if IMAGE_SKIP_RE.search(candidate):
                continue
            absolute = urljoin(base_url, candidate)
            if not absolute.startswith("http"):
                continue
            key = absolute.split("?", 1)[0]
            if key in seen:
                continue
            seen.add(key)
            images.append(absolute)
            break  # at most one photo per <img> tag
        if len(images) >= limit:
            break
    return images


def extract_image(node, base_url: str) -> str | None:
    """First usable listing thumbnail URL within a card/item, or None."""
    images = extract_images(node, base_url, limit=1)
    return images[0] if images else None


def images_from_rss_entry(entry, summary_html: str) -> list[str]:
    """Best-effort photo URLs from an RSS entry (media/enclosure/summary <img>)."""
    images: list[str] = []
    seen: set[str] = set()

    def add(value: str | None) -> None:
        if not isinstance(value, str) or not value.startswith("http"):
            return
        if IMAGE_SKIP_RE.search(value):
            return
        key = value.split("?", 1)[0]
        if key in seen:
            return
        seen.add(key)
        images.append(value)

    for media in getattr(entry, "media_content", None) or []:
        add(media.get("url") if hasattr(media, "get") else None)
    for thumb in getattr(entry, "media_thumbnail", None) or []:
        add(thumb.get("url") if hasattr(thumb, "get") else None)
    for enclosure in getattr(entry, "enclosures", None) or []:
        if not hasattr(enclosure, "get"):
            continue
        enc_type = str(enclosure.get("type", ""))
        if enc_type and not enc_type.startswith("image"):
            continue
        add(enclosure.get("href") or enclosure.get("url"))

    soup = BeautifulSoup(summary_html or "", "html.parser")
    for img in soup.find_all("img"):
        src = img.get("src")
        if src and not src.startswith("data:"):
            add(src)
    return images


def build_listing(
    source_name: str,
    title: str,
    url: str,
    text: str,
    image: str | None = None,
    images: list[str] | None = None,
) -> Listing:
    gallery = list(images) if images else ([image] if image else [])
    full_text = " ".join([title or "", text or ""]).strip()
    costs = parse_cost_fields(full_text)
    return Listing(
        source_name=source_name,
        title=clean_title(title, text, url),
        url=url,
        text=full_text,
        # Prefer a labelled Kaltmiete over the first euro amount on the card,
        # so a leading Kaution/Provision figure isn't mistaken for the rent.
        price_eur=costs["kalt"] if costs["kalt"] is not None else parse_price(full_text),
        area_sqm=parse_area(full_text),
        rooms=parse_rooms(full_text),
        location=parse_location(full_text),
        floor=parse_floor(full_text),
        image=gallery[0] if gallery else None,
        images=gallery,
        kaltmiete_eur=costs["kalt"],
        nebenkosten_eur=costs["neben"],
        heizkosten_eur=costs["heiz"],
        warmmiete_eur=costs["warm"],
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
