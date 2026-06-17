import unittest
from unittest.mock import patch

import requests

from wohnungssuche.filters import MatchResult
from wohnungssuche.models import Listing
from wohnungssuche.search import (
    dedupe_matches,
    dedupe_report_matches,
    fetch_url,
    format_listing,
    format_report,
    score_listing,
    should_fail_run,
    should_show_as_review_candidate,
)


class SearchReportTests(unittest.TestCase):
    def test_listing_contains_clickable_rating_fields(self):
        listing = Listing(
            source_name="test",
            title="Wohnung zur Miete 3 Zimmer, 80 qm, EG",
            url="https://example.test/listing",
            text="3 Zimmer 80 qm 900 EUR EG Barsinghausen",
            rooms=3,
            area_sqm=80,
            price_eur=900,
            floor="eg",
        )
        result = MatchResult(
            accepted=True,
            reasons=["3 Zimmer", "80 qm", "900 EUR"],
            review_notes=[],
        )

        markdown = "\n".join(format_listing(1, listing, result, review_candidate=False))

        self.assertIn("### \U0001F7E9 NEU 1.", markdown)
        self.assertIn("<summary>Bewertung anklicken</summary>", markdown)
        self.assertIn("Bitte pro Person genau ein Feld markieren.", markdown)
        self.assertIn("\U0001F535 stewalpp (Blau)", markdown)
        self.assertIn("\U0001F7E2 gishaa-create (Gruen)", markdown)
        self.assertIn("- [ ] Gut", markdown)
        self.assertIn("- [ ] Vielleicht", markdown)
        self.assertIn("- [ ] Schlecht", markdown)
        self.assertEqual(markdown.count("- [ ] "), 6)
        self.assertNotIn("- [ ] 10", markdown)

    def test_partial_source_errors_do_not_fail_run(self):
        self.assertFalse(should_fail_run(["Immowelt: 403"], successful_sources=1))
        self.assertTrue(should_fail_run(["Immowelt: 403"], successful_sources=0))

    def test_fetch_url_retries_transient_403(self):
        class DummyResponse:
            def __init__(self, status_code):
                self.status_code = status_code
                self.headers = {}
                self.content = b"ok"

            def raise_for_status(self):
                if self.status_code >= 400:
                    raise requests.HTTPError(f"{self.status_code} error")

        with (
            patch("wohnungssuche.search.requests.get") as get,
            patch("wohnungssuche.search.time.sleep") as sleep,
        ):
            get.side_effect = [DummyResponse(403), DummyResponse(200)]

            response = fetch_url("https://example.test")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_floor_review_duplicate_wins_over_exact_match(self):
        exact_listing = Listing(
            source_name="test",
            title="3 Zimmer Wohnung",
            url="https://example.test/listing",
            text="3 Zimmer 80 qm 900 EUR Barsinghausen",
        )
        floor_review_listing = Listing(
            source_name="test",
            title="3 Zimmer Wohnung im 1. OG",
            url="https://example.test/listing",
            text="3 Zimmer 80 qm 900 EUR 1. OG Barsinghausen",
        )

        exact, floor_review = dedupe_report_matches(
            [
                (
                    exact_listing,
                    MatchResult(True, ["3 Zimmer", "80 qm", "900 EUR"], ["Etage pruefen"]),
                )
            ],
            [
                (
                    floor_review_listing,
                    MatchResult(False, ["kein EG/Parterre: 1. og"], []),
                )
            ],
        )

        self.assertEqual(exact, [])
        self.assertEqual([listing.id for listing, _ in floor_review], [floor_review_listing.id])

    def test_report_contains_colored_listing_legend(self):
        listing = Listing(
            source_name="test",
            title="Wohnung zur Miete 3 Zimmer, 80 qm, EG",
            url="https://example.test/listing",
            text="3 Zimmer 80 qm 900 EUR EG Barsinghausen",
            rooms=3,
            area_sqm=80,
            price_eur=900,
            floor="eg",
        )
        review_listing = Listing(
            source_name="test",
            title="Wohnung zur Miete 3 Zimmer, 80 qm, 1. OG",
            url="https://example.test/review-listing",
            text="3 Zimmer 80 qm 900 EUR 1. OG Barsinghausen",
            rooms=3,
            area_sqm=80,
            price_eur=900,
            floor="1. og",
        )
        markdown = format_report(
            [(listing, MatchResult(True, ["3 Zimmer", "80 qm", "900 EUR"], []))],
            [(review_listing, MatchResult(False, ["kein EG/Parterre: 1. og"], []))],
            [],
        )

        self.assertIn("Legende: \U0001F7E9 NEU passt gut", markdown)
        self.assertIn("## Schnelluebersicht", markdown)
        self.assertIn("| Typ | Prioritaet | Score | Ort | Preis | Groesse | Etage | Titel |", markdown)
        self.assertIn("### \U0001F7E9 NEU 1.", markdown)
        self.assertIn("### \U0001F7E8 PRUEFEN 1.", markdown)

    def test_priority_places_score_higher_than_farther_places(self):
        criteria = {
            "min_rooms": 3,
            "min_area_sqm": 70,
            "max_total_rent_eur": 1000,
            "require_ground_floor": True,
            "desired_floor_terms": ["eg", "erdgeschoss", "parterre"],
            "location_priority_terms": {
                "high": ["barsinghausen", "egestorf", "wennigsen", "wennigser mark", "kirchdorf"],
                "low": ["seelze"],
            },
        }
        result = MatchResult(True, ["3 Zimmer", "80 qm", "900 EUR"], [])
        high_listing = Listing(
            source_name="test",
            title="3 Zimmer Wohnung EG",
            url="https://example.test/high",
            text="3 Zimmer 80 qm 900 EUR EG Kirchdorf Barsinghausen",
            rooms=3,
            area_sqm=80,
            price_eur=900,
            floor="eg",
        )
        low_listing = Listing(
            source_name="test",
            title="3 Zimmer Wohnung EG",
            url="https://example.test/low",
            text="3 Zimmer 80 qm 900 EUR EG Seelze",
            rooms=3,
            area_sqm=80,
            price_eur=900,
            floor="eg",
        )

        high_score, high_priority, _ = score_listing(high_listing, result, criteria)
        low_score, low_priority, _ = score_listing(low_listing, result, criteria)

        self.assertEqual(high_priority, "hoch")
        self.assertEqual(low_priority, "weiter weg")
        self.assertGreater(high_score, low_score)

    def test_unknown_floor_is_review_candidate_not_green(self):
        result = MatchResult(True, ["3 Zimmer", "80 qm", "900 EUR"], ["Etage pruefen"])

        self.assertTrue(
            should_show_as_review_candidate(
                result,
                {"include_floor_review_candidates": True},
            )
        )

    def test_fuzzy_duplicate_detection_merges_provider_duplicates(self):
        first = Listing(
            source_name="Immowelt",
            title="Wohnung zur Miete 3 Zimmer EG",
            url="https://example.test/a",
            text="3 Zimmer 80 qm 900 EUR EG Kirchdorf Barsinghausen",
            rooms=3,
            area_sqm=80,
            price_eur=900,
            floor="eg",
        )
        duplicate = Listing(
            source_name="Immobilo",
            title="Wohnung zur Miete 3 Zimmer EG",
            url="https://example.test/b",
            text="3 Zimmer 80 qm 900 EUR EG Kirchdorf Barsinghausen",
            rooms=3,
            area_sqm=80,
            price_eur=900,
            floor="eg",
        )

        deduped = dedupe_matches(
            [
                (first, MatchResult(True, ["3 Zimmer"], [])),
                (duplicate, MatchResult(True, ["3 Zimmer"], [])),
            ]
        )

        self.assertEqual(len(deduped), 1)


if __name__ == "__main__":
    unittest.main()
