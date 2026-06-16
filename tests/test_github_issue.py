import os
import unittest
from unittest.mock import patch

from wohnungssuche.github_issue import notification_mentions, status_body_from_report


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


if __name__ == "__main__":
    unittest.main()
