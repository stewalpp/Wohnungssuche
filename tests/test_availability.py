import unittest

from wohnungssuche.availability import (
    STATUS_AVAILABLE,
    STATUS_UNAVAILABLE,
    STATUS_UNKNOWN,
    determine_availability,
    should_notify,
    update_availability,
)


CHECKED_AT = "2026-06-17T10:00:00+00:00"


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


class UpdateAvailabilityTests(unittest.TestCase):
    def test_first_check_of_untracked_entry_emits_no_false_change(self):
        # Entry written only by mark_seen (no availability_status) that is now
        # gone must NOT fire a bogus "Neu nicht mehr gefunden" on the first audit.
        state = {"seen": {"x": {"url": "https://example.test/expose/1", "source": "Quelle"}}}
        changes = update_availability(
            state,
            current_ids=set(),
            current_urls=set(),
            source_errors={},
            active_sources={"Quelle"},
            checked_at=CHECKED_AT,
        )
        self.assertEqual(changes, [])
        self.assertEqual(state["seen"]["x"]["availability_status"], STATUS_UNAVAILABLE)
        self.assertNotIn("status_changed_at", state["seen"]["x"])

    def test_tracked_available_going_unavailable_emits_change(self):
        state = {"seen": {"x": {
            "url": "https://example.test/expose/1", "source": "Quelle",
            "availability_status": STATUS_AVAILABLE,
        }}}
        changes = update_availability(
            state,
            current_ids=set(),
            current_urls=set(),
            source_errors={},
            active_sources={"Quelle"},
            checked_at=CHECKED_AT,
        )
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["previous_status"], STATUS_AVAILABLE)
        self.assertEqual(changes[0]["new_status"], STATUS_UNAVAILABLE)

    def test_relist_breadcrumb_emits_wieder_sichtbar_change(self):
        # The daily search already flipped it back to "available" and left a
        # relisted_at breadcrumb; the weekly audit must surface + notify it,
        # even though the plain previous->new diff sees no change.
        state = {"seen": {"x": {
            "url": "https://example.test/expose/1", "source": "Quelle",
            "availability_status": STATUS_AVAILABLE, "relisted_at": "2026-06-16T09:00:00+00:00",
        }}}
        changes = update_availability(
            state,
            current_ids={"x"},
            current_urls=set(),
            source_errors={},
            active_sources={"Quelle"},
            checked_at=CHECKED_AT,
        )
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["previous_status"], STATUS_UNAVAILABLE)
        self.assertEqual(changes[0]["new_status"], STATUS_AVAILABLE)
        self.assertTrue(should_notify(changes))
        self.assertNotIn("relisted_at", state["seen"]["x"])  # consumed


if __name__ == "__main__":
    unittest.main()

