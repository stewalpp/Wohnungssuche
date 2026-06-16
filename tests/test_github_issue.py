import os
import unittest
from unittest.mock import patch

from wohnungssuche.github_issue import (
    dashboard_body_from_report,
    notification_mentions,
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


if __name__ == "__main__":
    unittest.main()
