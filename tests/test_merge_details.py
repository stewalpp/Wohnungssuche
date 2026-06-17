import unittest

from wohnungssuche.models import Listing
from wohnungssuche.search import has_cost_data, merge_listing_details


def _listing(**kwargs) -> Listing:
    base = dict(source_name="test", title="Wohnung", url="https://example.test/x", text="")
    base.update(kwargs)
    return Listing(**base)


class MergeDetailsTests(unittest.TestCase):
    def test_merge_keeps_cost_fields_from_detail(self):
        original = _listing(price_eur=790.0)  # card: only the headline price
        detail = _listing(
            price_eur=790.0,
            kaltmiete_eur=790.0,
            nebenkosten_eur=185.0,
            heizkosten_eur=None,
            warmmiete_eur=975.0,
        )
        merged = merge_listing_details(original, detail)
        self.assertEqual(merged.kaltmiete_eur, 790.0)
        self.assertEqual(merged.nebenkosten_eur, 185.0)
        self.assertEqual(merged.warmmiete_eur, 975.0)

    def test_merge_keeps_images(self):
        original = _listing(images=["https://img/a.jpg"])
        detail = _listing(images=["https://img/a.jpg", "https://img/b.jpg"])
        merged = merge_listing_details(original, detail)
        self.assertEqual(len(merged.images), 2)

    def test_merge_falls_back_to_original_when_detail_missing(self):
        original = _listing(nebenkosten_eur=150.0, images=["https://img/a.jpg"])
        detail = _listing()  # detail page yielded nothing extra
        merged = merge_listing_details(original, detail)
        self.assertEqual(merged.nebenkosten_eur, 150.0)
        self.assertEqual(merged.images, ["https://img/a.jpg"])

    def test_has_cost_data(self):
        self.assertFalse(has_cost_data({}))
        self.assertFalse(has_cost_data({"nebenkosten_eur": None}))
        self.assertTrue(has_cost_data({"nebenkosten_eur": 185.0}))
        self.assertTrue(has_cost_data({"warmmiete_eur": 1000.0}))


if __name__ == "__main__":
    unittest.main()
