import unittest

from wohnungssuche.parser import (
    build_listing,
    parse_heizkosten,
    parse_kaltmiete,
    parse_nebenkosten,
    parse_warmmiete,
)


class CostLabelParsingTests(unittest.TestCase):
    def test_kaltmiete_label(self):
        self.assertEqual(parse_kaltmiete("Kaltmiete 790 €"), 790.0)
        self.assertEqual(parse_kaltmiete("Nettokaltmiete: 850,00 EUR"), 850.0)
        self.assertEqual(parse_kaltmiete("Grundmiete 700 €"), 700.0)

    def test_kaltmiete_suffix(self):
        self.assertEqual(parse_kaltmiete("3 Zi., 80 m², 850 € kalt"), 850.0)

    def test_nebenkosten_variants(self):
        self.assertEqual(parse_nebenkosten("Nebenkosten 180 €"), 180.0)
        self.assertEqual(parse_nebenkosten("Betriebskosten: 150 €"), 150.0)
        self.assertEqual(parse_nebenkosten("zzgl. NK 200 €"), 200.0)
        self.assertEqual(parse_nebenkosten("zzgl. 180 € Nebenkosten"), 180.0)

    def test_heizkosten(self):
        self.assertEqual(parse_heizkosten("Heizkosten 60 €"), 60.0)

    def test_warmmiete(self):
        self.assertEqual(parse_warmmiete("Warmmiete 1.050 €"), 1050.0)
        self.assertEqual(parse_warmmiete("Gesamtmiete: 1.234,56 €"), 1234.56)
        self.assertEqual(parse_warmmiete("1.050 € warm"), 1050.0)

    def test_amount_followed_by_period(self):
        # The € may be followed by punctuation/end — must still match.
        self.assertEqual(parse_nebenkosten("Nebenkosten 180 €."), 180.0)
        self.assertEqual(parse_warmmiete("Warmmiete 1.050 EUR."), 1050.0)

    def test_full_breakdown(self):
        text = (
            "Kaltmiete 790 € zzgl. 180 € Nebenkosten + 60 € Heizkosten, "
            "Warmmiete 1.030 €"
        )
        self.assertEqual(parse_kaltmiete(text), 790.0)
        self.assertEqual(parse_nebenkosten(text), 180.0)
        self.assertEqual(parse_heizkosten(text), 60.0)
        self.assertEqual(parse_warmmiete(text), 1030.0)

    # --- traps: must NOT match ---

    def test_per_sqm_is_ignored(self):
        self.assertIsNone(parse_nebenkosten("Nebenkosten 2,50 €/m²"))
        self.assertIsNone(parse_nebenkosten("Betriebskosten 2,50 €/m2"))
        self.assertIsNone(parse_nebenkosten("Nebenkosten ca. 3,10 €/qm"))

    def test_pro_monat_not_treated_as_per_area(self):
        # "pro Monat" must not be mistaken for a per-area marker.
        self.assertEqual(parse_nebenkosten("Nebenkosten 180 € pro Monat"), 180.0)

    def test_label_does_not_jump_over_other_label(self):
        # "Kaltmiete" must not swallow the Nebenkosten amount.
        text = "Kaltmiete und Nebenkosten 180 €"
        self.assertIsNone(parse_kaltmiete(text))
        self.assertEqual(parse_nebenkosten(text), 180.0)

    def test_warmmiete_below_kaltmiete_is_dropped(self):
        # warm < kalt is impossible -> the mis-assigned warm figure is discarded.
        text = "Kaltmiete 1.000 € Warmmiete 700 €"
        self.assertEqual(parse_kaltmiete(text), 1000.0)
        self.assertIsNone(parse_warmmiete(text))

    def test_no_amount(self):
        self.assertIsNone(parse_warmmiete("Warmmiete auf Anfrage"))
        self.assertIsNone(parse_nebenkosten("Nebenkosten nicht enthalten"))

    def test_unlabeled_price_is_not_a_cost_field(self):
        text = "Schöne 3 Zimmer Wohnung 80 qm 850 € Barsinghausen"
        self.assertIsNone(parse_kaltmiete(text))
        self.assertIsNone(parse_nebenkosten(text))
        self.assertIsNone(parse_warmmiete(text))

    def test_europa_not_euro(self):
        self.assertIsNone(parse_nebenkosten("Nebenkosten 50 europaweit"))


class NearestLabelAssignmentTests(unittest.TestCase):
    """Regressions distilled from the adversarial test-case generation."""

    def test_label_takes_nearest_amount_bare_price_drops(self):
        # The bare lead price (650) is farther from "Nebenkosten" than 110, so
        # the label binds 110 and 650 stays unlabelled (no kalt label near it).
        text = "1 Zimmer 28 m² München 650 € Nebenkosten 110 € Heizkosten 60 €"
        self.assertIsNone(parse_kaltmiete(text))
        self.assertEqual(parse_nebenkosten(text), 110.0)
        self.assertEqual(parse_heizkosten(text), 60.0)

    def test_combined_label_binds_to_nearest(self):
        # "NK u. Heizung 240 €": 240 is nearest to "Heizung" → heiz, not neben.
        text = "Kaltmiete 690 € zzgl. NK u. Heizung 240 € Warmmiete 930 €"
        self.assertEqual(parse_kaltmiete(text), 690.0)
        self.assertEqual(parse_heizkosten(text), 240.0)
        self.assertIsNone(parse_nebenkosten(text))
        self.assertEqual(parse_warmmiete(text), 930.0)

    def test_plus_equals_breakdown(self):
        text = ("Grundmiete 1.480 € + Betriebskosten 320 € + Heizung 140 € "
                "= Warmmiete 1.940 €")
        self.assertEqual(parse_kaltmiete(text), 1480.0)
        self.assertEqual(parse_nebenkosten(text), 320.0)
        self.assertEqual(parse_heizkosten(text), 140.0)
        self.assertEqual(parse_warmmiete(text), 1940.0)

    def test_kaution_out_of_band_ignored(self):
        text = "48 m² Nürnberg 7.500 EUR Kaution Kaltmiete 590 € Nebenkosten 95 €"
        self.assertEqual(parse_kaltmiete(text), 590.0)
        self.assertEqual(parse_nebenkosten(text), 95.0)


class BuildListingCostFieldsTests(unittest.TestCase):
    def test_fields_populated_from_text(self):
        listing = build_listing(
            "test",
            "3 Zimmer Wohnung",
            "https://example.test/x",
            "850 € Kaltmiete, Nebenkosten 200 €, Warmmiete 1.050 €, EG Barsinghausen",
        )
        self.assertEqual(listing.kaltmiete_eur, 850.0)
        self.assertEqual(listing.nebenkosten_eur, 200.0)
        self.assertEqual(listing.warmmiete_eur, 1050.0)
        self.assertIsNone(listing.heizkosten_eur)

    def test_fields_none_when_not_stated(self):
        listing = build_listing(
            "test",
            "3 Zimmer Wohnung",
            "https://example.test/y",
            "3 Zimmer 80 qm 850 € EG Barsinghausen",
        )
        self.assertIsNone(listing.kaltmiete_eur)
        self.assertIsNone(listing.nebenkosten_eur)
        self.assertIsNone(listing.heizkosten_eur)
        self.assertIsNone(listing.warmmiete_eur)


if __name__ == "__main__":
    unittest.main()
