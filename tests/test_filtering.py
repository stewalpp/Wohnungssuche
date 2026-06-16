import unittest

from wohnungssuche.filters import evaluate_listing
from wohnungssuche.models import Listing
from wohnungssuche.parser import (
    build_listing,
    clean_title,
    parse_area,
    parse_floor,
    parse_price,
    parse_rooms,
)
from wohnungssuche.state import is_seen, mark_seen


CRITERIA = {
    "min_rooms": 3,
    "min_area_sqm": 70,
    "max_total_rent_eur": 1000,
    "require_ground_floor": True,
    "allow_unknown_floor": True,
    "strict_location": True,
    "allowed_location_terms": [
        "barsinghausen",
        "bantorf",
        "goxe",
        "gross munzel",
        "gehrden",
        "wennigsen",
        "empelde",
    ],
    "excluded_location_terms": [", hannover", "hannover (", "bad nenndorf"],
    "desired_floor_terms": ["erdgeschoss", "eg", "parterre", "hochparterre"],
    "excluded_terms": ["altbau", "dachgeschoss"],
}


class FilteringTests(unittest.TestCase):
    def test_parse_german_listing_values(self):
        text = "Wohnung zur Miete 990 EUR 3 Zimmer 70,6 m2 EG"

        self.assertEqual(parse_price(text), 990)
        self.assertEqual(parse_rooms(text), 3)
        self.assertEqual(parse_area(text), 70.6)
        self.assertEqual(parse_floor("Geschoss 6/7"), "6. geschoss")
        self.assertEqual(parse_floor("im 1. OG mit Balkon"), "1. og")
        self.assertEqual(parse_floor("2 Stock"), "2 stock")

    def test_parse_price_after_image_counter(self):
        self.assertEqual(parse_price("1 / 9 800 EUR Kaltmiete"), 800)
        self.assertEqual(parse_price("1 / 2 980 € Kaltmiete"), 980)

    def test_clean_title_removes_portal_card_noise(self):
        title = (
            "1 / 8 Neu B 715 EUR Kaltmiete Wohnung zur Miete "
            "3 Zimmer | 80 m2 | 1. Geschoss | frei ab 01.09.2026"
        )

        self.assertEqual(
            clean_title(title),
            "Wohnung zur Miete 3 Zimmer, 80 qm, 1. Geschoss",
        )

    def test_clean_title_uses_kleinanzeigen_slug_when_link_text_is_counter(self):
        self.assertEqual(
            clean_title(
                "14",
                "14 14 31542 Bad Nenndorf Bad Nenndorf, Sonnige 3-Zimmer-Maisonette-Wohnug",
                "https://www.kleinanzeigen.de/s-anzeige/bad-nenndorf-sonnige-3-zimmer-maisonette-wohnug-/3404385210-203-2859",
            ),
            "Bad Nenndorf Sonnige 3 Zimmer Maisonette Wohnung",
        )

    def test_rejects_too_expensive_listing(self):
        listing = build_listing(
            "test",
            "3 Zimmer Wohnung",
            "https://example.test/a",
            "3 Zimmer 80 qm 1.200 EUR EG Barsinghausen",
        )

        result = evaluate_listing(listing, CRITERIA)

        self.assertFalse(result.accepted)
        self.assertIn("zu teuer", result.reasons[0])

    def test_accepts_unknown_floor_with_review_note(self):
        listing = build_listing(
            "test",
            "3 Zimmer Wohnung Barsinghausen",
            "https://example.test/b",
            "3 Zimmer 80 qm 900 EUR Barsinghausen",
        )

        result = evaluate_listing(listing, CRITERIA)

        self.assertTrue(result.accepted)
        self.assertIn("Etage pruefen", result.review_notes)

    def test_rejects_known_non_ground_floor(self):
        listing = build_listing(
            "test",
            "3 Zimmer Wohnung Barsinghausen",
            "https://example.test/non-eg",
            "3 Zimmer 80 qm 900 EUR 1. Geschoss Barsinghausen",
        )

        result = evaluate_listing(listing, CRITERIA)

        self.assertFalse(result.accepted)
        self.assertIn("kein EG", result.reasons[0])

    def test_rejects_hannover_city_listing(self):
        listing = build_listing(
            "test",
            "Wohnung zur Miete 3 Zimmer, 80 qm, EG",
            "https://example.test/hannover-city",
            "3 Zimmer 80 qm 900 EUR EG Badenstedt, Hannover (30455)",
        )

        result = evaluate_listing(listing, CRITERIA)

        self.assertFalse(result.accepted)
        self.assertIn("ausgeschlossen", result.reasons[0])

    def test_allows_region_hannover_outside_city(self):
        listing = build_listing(
            "test",
            "Wohnung zur Miete 3 Zimmer, 80 qm, EG",
            "https://example.test/barsinghausen",
            "3 Zimmer 80 qm 900 EUR EG Barsinghausen (30890), Region Hannover",
        )

        result = evaluate_listing(listing, CRITERIA)

        self.assertTrue(result.accepted)

    def test_allows_barsinghausen_district_with_german_character(self):
        listing = build_listing(
            "test",
            "Wohnung zur Miete 3 Zimmer, 80 qm, EG",
            "https://example.test/gross-munzel",
            "3 Zimmer 80 qm 900 EUR EG Gro\u00df Munzel (30890)",
        )

        result = evaluate_listing(listing, CRITERIA)

        self.assertTrue(result.accepted)

    def test_allows_nearby_corridor_places(self):
        for place in ["Gehrden", "Wennigsen", "Empelde"]:
            with self.subTest(place=place):
                listing = build_listing(
                    "test",
                    "Wohnung zur Miete 3 Zimmer, 80 qm, EG",
                    f"https://example.test/{place.lower()}",
                    f"3 Zimmer 80 qm 900 EUR EG {place}",
                )

                result = evaluate_listing(listing, CRITERIA)

                self.assertTrue(result.accepted)

    def test_rejects_bad_nenndorf_outside_scope(self):
        listing = build_listing(
            "test",
            "Wohnung zur Miete 3 Zimmer, 80 qm, EG",
            "https://example.test/bad-nenndorf",
            "3 Zimmer 80 qm 900 EUR EG Bad Nenndorf (31542)",
        )

        result = evaluate_listing(listing, CRITERIA)

        self.assertFalse(result.accepted)
        self.assertIn("ausgeschlossen", result.reasons[0])

    def test_rejects_external_place_even_when_source_location_is_barsinghausen(self):
        listing = build_listing(
            "test",
            "Hochwertige 3 Zimmer Wohnung Bestlage in Bad Nenndorf",
            "https://example.test/bad-nenndorf-in-barsinghausen-source",
            "3 Zimmer 79 qm 987 EUR 30890 Barsinghausen Hochwertige 3 Zimmer Wohnung Bestlage in Bad Nenndorf",
        )

        result = evaluate_listing(listing, CRITERIA)

        self.assertFalse(result.accepted)
        self.assertIn("ausgeschlossen", result.reasons[0])

    def test_seen_state_marks_listing_once(self):
        listing = Listing(
            source_name="test",
            title="3 Zimmer EG Wohnung",
            url="https://example.test/c",
            text="3 Zimmer 80 qm 900 EUR EG Barsinghausen",
        )
        state = {"version": 1, "seen": {}}

        self.assertFalse(is_seen(state, listing))
        mark_seen(state, [listing])
        self.assertTrue(is_seen(state, listing))


if __name__ == "__main__":
    unittest.main()
