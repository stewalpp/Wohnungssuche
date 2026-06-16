from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


TRACKING_PARAMS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "ref",
}


def canonical_url(url: str) -> str:
    if not url:
        return ""
    parts = urlsplit(url.strip())
    netloc = parts.netloc.lower()
    path = parts.path.rstrip("/")
    if any(
        domain in netloc
        for domain in (
            "immowelt.de",
            "immobilienscout24.de",
            "kleinanzeigen.de",
            "wohnungsboerse.net",
            "immobilo.de",
        )
    ):
        path = path.lower()
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() not in TRACKING_PARAMS
    ]
    clean_query = urlencode(query, doseq=True)
    return urlunsplit(
        (parts.scheme.lower(), netloc, path, clean_query, "")
    )


def make_listing_id(url: str, title: str, source_name: str) -> str:
    identity = canonical_url(url) or f"{source_name}|{title}".lower().strip()
    return sha256(identity.encode("utf-8")).hexdigest()[:16]


@dataclass(slots=True)
class Listing:
    source_name: str
    title: str
    url: str
    text: str
    price_eur: float | None = None
    area_sqm: float | None = None
    rooms: float | None = None
    location: str | None = None
    floor: str | None = None
    published: str | None = None
    id: str = field(init=False)

    def __post_init__(self) -> None:
        self.url = canonical_url(self.url)
        self.title = " ".join((self.title or "").split())
        self.text = " ".join((self.text or self.title).split())
        self.id = make_listing_id(self.url, self.title, self.source_name)
