from pathlib import Path
import unittest

import yaml


class SearchConfigTests(unittest.TestCase):
    def test_extended_kleinanzeigen_sources_use_location_ids(self):
        config = yaml.safe_load(Path("config/search.yml").read_text(encoding="utf-8"))
        sources = {source["name"]: source["url"] for source in config["sources"]}

        expected_fragments = {
            "Kleinanzeigen Gehrden 3 Zimmer": "l14210",
            "Kleinanzeigen Wennigsen 3 Zimmer": "l14212",
            "Kleinanzeigen Ronnenberg 3 Zimmer": "l2902",
            "Kleinanzeigen Seelze 3 Zimmer": "l2920",
        }

        for source_name, location_id in expected_fragments.items():
            with self.subTest(source=source_name):
                self.assertIn(location_id, sources[source_name])


if __name__ == "__main__":
    unittest.main()
