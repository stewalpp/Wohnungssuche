import unittest

from wohnungssuche.filters import MatchResult
from wohnungssuche.models import Listing
from wohnungssuche.search import dedupe_report_matches, format_listing, should_fail_run


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


if __name__ == "__main__":
    unittest.main()
