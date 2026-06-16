import unittest

from wohnungssuche.availability import (
    STATUS_AVAILABLE,
    STATUS_UNAVAILABLE,
    STATUS_UNKNOWN,
    determine_availability,
    should_notify,
)


class AvailabilityTests(unittest.TestCase):
    def test_available_when_url_is_still_in_search_results(self):
        status, note = determine_availability(
            "abc",
            {"url": "https://example.test/expose/1", "source": "Quelle"},
            current_ids=set(),
            current_urls={"https://example.test/expose/1"},
            source_errors={},
            active_sources={"Quelle"},
        )

        self.assertEqual(status, STATUS_AVAILABLE)
        self.assertIn("gefunden", note)

    def test_unavailable_when_source_checked_but_listing_missing(self):
        status, note = determine_availability(
            "abc",
            {"url": "https://example.test/expose/1", "source": "Quelle"},
            current_ids=set(),
            current_urls=set(),
            source_errors={},
            active_sources={"Quelle"},
        )

        self.assertEqual(status, STATUS_UNAVAILABLE)
        self.assertIn("nicht mehr", note)

    def test_unknown_when_source_failed(self):
        status, note = determine_availability(
            "abc",
            {"url": "https://example.test/expose/1", "source": "Quelle"},
            current_ids=set(),
            current_urls=set(),
            source_errors={"Quelle": "403"},
            active_sources={"Quelle"},
        )

        self.assertEqual(status, STATUS_UNKNOWN)
        self.assertIn("nicht geprueft", note)

    def test_notify_only_for_relevant_changes(self):
        self.assertTrue(
            should_notify(
                [{"previous_status": STATUS_AVAILABLE, "new_status": STATUS_UNAVAILABLE}]
            )
        )
        self.assertTrue(
            should_notify(
                [{"previous_status": STATUS_UNAVAILABLE, "new_status": STATUS_AVAILABLE}]
            )
        )
        self.assertFalse(
            should_notify([{"previous_status": None, "new_status": STATUS_AVAILABLE}])
        )


if __name__ == "__main__":
    unittest.main()

