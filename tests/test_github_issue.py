import os
import unittest
from unittest.mock import patch

from wohnungssuche.github_issue import (
    _next_link,
    dashboard_body_from_report,
    is_report_comment,
    notification_mentions,
    request_all_pages,
    status_body_from_report,
)


class GitHubIssueTests(unittest.TestCase):
    def test_notification_mentions_support_multiple_users(self):
        with patch.dict(
            os.environ,
            {"GITHUB_NOTIFICATION_USERS": "stewalpp,gishaa-create"},
            clear=True,
        ):
            self.assertEqual(notification_mentions(), "@stewalpp @gishaa-create")

    def test_notification_mentions_keep_legacy_single_user(self):
        with patch.dict(
            os.environ,
            {"GITHUB_NOTIFICATION_USER": "@stewalpp"},
            clear=True,
        ):
            self.assertEqual(notification_mentions(), "@stewalpp")

    def test_status_body_summarizes_last_run_without_mentions(self):
        markdown = (
            "# Neue Wohnungsangebote (2026-06-16 16:05)\n\n"
            "Keine neuen passenden Inserate gefunden.\n\n"
            "Bereits bekannte Wohnungen wurden ausgeblendet.\n"
        )

        body = status_body_from_report(markdown)

        self.assertIn("<!-- wohnungssuche-status -->", body)
        self.assertIn("## Letzter Suchlauf", body)
        self.assertIn("Keine neuen passenden Inserate gefunden.", body)
        self.assertNotIn("@stewalpp", body)

    def test_status_body_names_sources_with_errors(self):
        markdown = (
            "# Neue Wohnungsangebote (2026-06-16 16:05)\n\n"
            "Keine neuen passenden Inserate gefunden.\n\n"
            "Bereits bekannte Wohnungen wurden ausgeblendet.\n"
            "## Quellen mit Fehlern\n\n"
            "- Immowelt Region Hannover 3 Zimmer: 403 Client Error\n"
            "- Immowelt Barsinghausen 3 Zimmer: 403 Client Error\n"
        )

        body = status_body_from_report(markdown)

        self.assertIn("Diese Quellen hatten beim letzten Lauf Probleme", body)
        self.assertIn("Immowelt Region Hannover 3 Zimmer", body)
        self.assertIn("Immowelt Barsinghausen 3 Zimmer", body)

    def test_status_body_does_not_include_listing_details(self):
        markdown = (
            "# Neue Wohnungsangebote (2026-06-16 16:22)\n\n"
            "14 neue passende Inserate gefunden.\n\n"
            "### 1. Beispielwohnung\n\n"
            "- Preis: 740 EUR\n"
            "<details>\n"
            "<summary>Bewertung anklicken</summary>\n"
            "</details>\n"
        )

        body = status_body_from_report(markdown)

        self.assertIn("14 neue passende Inserate gefunden.", body)
        self.assertNotIn("<details>", body.replace("<!-- wohnungssuche-status -->", ""))
        self.assertNotIn("Beispielwohnung", body)

    def test_dashboard_body_puts_latest_run_at_top(self):
        markdown = (
            "# Neue Wohnungsangebote (2026-06-16 16:22)\n\n"
            "14 neue passende Inserate gefunden.\n\n"
            "Legende: \U0001F7E9 NEU passt gut.\n\n"
            "### \U0001F7E9 NEU 1. Beispielwohnung\n\n"
            "- Preis: 740 EUR\n"
        )

        body = dashboard_body_from_report(
            markdown,
            "https://github.com/stewalpp/Wohnungssuche/issues/1#issuecomment-1",
        )

        self.assertTrue(body.startswith("<!-- wohnungssuche-dashboard -->"))
        self.assertIn("# Aktueller Stand", body)
        self.assertIn("14 neue passende Inserate gefunden.", body)
        self.assertIn("Letzte Trefferliste: [Kommentar oeffnen]", body)
        self.assertIn("## Neue Wohnungsangebote (2026-06-16 16:22)", body)
        self.assertIn("### \U0001F7E9 NEU 1. Beispielwohnung", body)


class ReportDetectionTests(unittest.TestCase):
    def test_match_count_line_is_a_report(self):
        self.assertTrue(is_report_comment("Vorspann\n\n3 neue passende Inserate gefunden\n"))

    def test_pruefkandidaten_only_report_detected_via_header(self):
        # A run with zero matches but floor-review candidates emits no count line,
        # only the report header — it must still be recognised as a report.
        body = (
            "@steffen\n\n# Neue Wohnungsangebote (2026-06-17 10:00)\n\n"
            "## Pruefkandidaten\n\n### 1. Beispiel\n"
        )
        self.assertTrue(is_report_comment(body))

    def test_availability_report_is_not_a_search_report(self):
        body = "# Verfuegbarkeitscheck (2026-06-17 10:00)\n\nGepruefte bekannte Inserate: 5\n"
        self.assertFalse(is_report_comment(body))


class PaginationTests(unittest.TestCase):
    def test_next_link_extracts_next_url(self):
        link = (
            '<https://api.github.com/x?page=2>; rel="next", '
            '<https://api.github.com/x?page=5>; rel="last"'
        )
        self.assertEqual(_next_link({"Link": link}), "https://api.github.com/x?page=2")

    def test_next_link_none_without_next(self):
        self.assertIsNone(_next_link({"Link": '<https://api.github.com/x?page=1>; rel="prev"'}))
        self.assertIsNone(_next_link({}))
        self.assertIsNone(_next_link(None))

    def test_request_all_pages_concatenates_followed_pages(self):
        pages = iter([
            ([{"id": 1}, {"id": 2}], {"Link": '<https://api.github.com/next>; rel="next"'}),
            ([{"id": 3}], {}),
        ])
        with patch("wohnungssuche.github_issue._request", side_effect=lambda *a, **k: next(pages)):
            items = request_all_pages("/repos/x/issues/1/comments?per_page=100", "tok")
        self.assertEqual([c["id"] for c in items], [1, 2, 3])


if __name__ == "__main__":
    unittest.main()
