from pathlib import Path
import unittest

import yaml


class SearchConfigTests(unittest.TestCase):
    def load_sources(self):
        config = yaml.safe_load(Path("config/search.yml").read_text(encoding="utf-8"))
        return {source["name"]: source["url"] for source in config["sources"]}

    def test_extended_kleinanzeigen_sources_use_location_ids(self):
        sources = self.load_sources()

        expected_fragments = {
            "Kleinanzeigen Gehrden 3 Zimmer": "l14210",
            "Kleinanzeigen Wennigsen 3 Zimmer": "l14212",
            "Kleinanzeigen Ronnenberg 3 Zimmer": "l2902",
            "Kleinanzeigen Seelze 3 Zimmer": "l2920",
        }

        for source_name, location_id in expected_fragments.items():
            with self.subTest(source=source_name):
                self.assertIn(location_id, sources[source_name])

    def test_non_kleinanzeigen_sources_are_configured(self):
        sources = self.load_sources()

        expected_sources = [
            "Immowelt Gehrden 3 Zimmer",
            "Immowelt Ronnenberg 3 Zimmer",
            "Immowelt Seelze 3 Zimmer",
            "Immowelt Wennigsen 3 Zimmer",
            "Immobilo Barsinghausen 3 Zimmer",
            "Immobilo Seelze 3 Zimmer",
            "Wohnungsboerse Barsinghausen 3 Zimmer",
            "Wohnungsboerse Ronnenberg 3 Zimmer",
        ]

        for source_name in expected_sources:
            with self.subTest(source=source_name):
                self.assertIn(source_name, sources)


if __name__ == "__main__":
    unittest.main()
