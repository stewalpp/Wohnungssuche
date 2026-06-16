import os
import unittest
from unittest.mock import patch

from wohnungssuche.notifier import (
    build_sms_body,
    build_subject,
    env_bool,
    mask_email,
    mask_phone,
    send_search_notifications,
)


class NotifierTests(unittest.TestCase):
    def test_build_subject_counts(self):
        self.assertEqual(build_subject(1, 0), "Wohnungssuche: 1 Treffer")
        self.assertEqual(
            build_subject(0, 14), "Wohnungssuche: 14 Pruefkandidaten"
        )
        self.assertEqual(
            build_subject(1, 2), "Wohnungssuche: 1 Treffer, 2 Pruefkandidaten"
        )

    def test_build_sms_body_includes_issue_link(self):
        body = build_sms_body(1, 2, "https://github.com/example/repo/issues/1")

        self.assertIn("1 Treffer", body)
        self.assertIn("2 Pruefkandidaten", body)
        self.assertIn("https://github.com/example/repo/issues/1", body)

    def test_missing_delivery_secrets_skip_notifications(self):
        keys = [
            "NOTIFY_EMAIL_TO",
            "SMTP_HOST",
            "SMTP_USERNAME",
            "SMTP_PASSWORD",
            "SMS_TO_NUMBER",
            "TWILIO_ACCOUNT_SID",
            "TWILIO_AUTH_TOKEN",
            "TWILIO_FROM_NUMBER",
        ]
        with patch.dict(os.environ, {key: "" for key in keys}, clear=False):
            self.assertEqual(
                send_search_notifications("report", exact_matches=1, review_candidates=0),
                [],
            )

    def test_masking_helpers(self):
        self.assertEqual(mask_email("gis.haa@example.net"), "gi***@example.net")
        self.assertEqual(mask_phone("+4915757226512"), "***6512")

    def test_env_bool(self):
        with patch.dict(os.environ, {"FLAG": "false"}):
            self.assertFalse(env_bool("FLAG", default=True))
        with patch.dict(os.environ, {"FLAG": ""}):
            self.assertTrue(env_bool("FLAG", default=True))
        with patch.dict(os.environ, {}, clear=True):
            self.assertTrue(env_bool("FLAG", default=True))


if __name__ == "__main__":
    unittest.main()
