"""
Rule precedence tests that run against fixture data (no API needed).

Covers:
- WB-only rule application
- Ozon-only rule application
- Combined WB+Ozon strictest-rule precedence
- Resolution, keyword, title length, mandatory field conflicts
- Regression scenarios verification
"""
import pytest


class TestWBOnlyRulePrecedenceFixtures:
    """Validate WB-only rule fixture data is correct and self-consistent."""

    def test_wb_min_resolution_is_900x900(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]
        assert rules["min_resolution"]["width"] == 900
        assert rules["min_resolution"]["height"] == 900

    def test_wb_max_file_size_10mb(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]
        assert rules["max_file_size_bytes"] == 10_485_760

    def test_wb_max_title_length_60(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]
        assert rules["max_title_length"] == 60

    def test_wb_max_additional_images_10(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]
        assert rules["max_additional_images"] == 10

    def test_wb_prohibited_keywords_include_wb_specific(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]
        prohibited = set(rules["prohibited_keywords"])
        assert "подделка" in prohibited
        assert "копия" in prohibited
        assert "реплика" in prohibited
        assert "18+" in prohibited
        assert "порно" in prohibited

    def test_wb_mandatory_fields(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]
        assert set(rules["mandatory_fields"]) == {"brand", "category", "name"}

    def test_wb_background_white_preferred(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]
        assert rules["background"] == "white_preferred"

    def test_wb_accepted_formats(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]
        assert set(rules["accepted_formats"]) == {"image/jpeg", "image/png", "image/webp"}


class TestOzonOnlyRulePrecedenceFixtures:
    """Validate Ozon-only rule fixture data is correct and self-consistent."""

    def test_ozon_min_resolution_is_1000x1000(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert rules["min_resolution"]["width"] == 1000
        assert rules["min_resolution"]["height"] == 1000

    def test_ozon_max_file_size_20mb(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert rules["max_file_size_bytes"] == 20_971_520

    def test_ozon_max_title_length_120(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert rules["max_title_length"] == 120

    def test_ozon_max_additional_images_15(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert rules["max_additional_images"] == 15

    def test_ozon_prohibited_keywords_include_ozon_specific(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        prohibited = set(rules["prohibited_keywords"])
        assert "реплика" in prohibited
        assert "фейк" in prohibited

    def test_ozon_does_not_prohibit_wb_specific_keywords(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        prohibited = set(rules["prohibited_keywords"])
        assert "подделка" not in prohibited
        assert "копия" not in prohibited
        assert "18+" not in prohibited
        assert "порно" not in prohibited

    def test_ozon_mandatory_fields_brand_only(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert set(rules["mandatory_fields"]) == {"brand"}

    def test_ozon_background_white_required(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert rules["background"] == "white_required"

    def test_ozon_accepted_formats(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert set(rules["accepted_formats"]) == {"image/jpeg", "image/png", "image/webp"}


class TestCombinedStrictestRulePrecedence:
    """Validate combined WB+Ozon strictest-rule fixture data."""

    def test_combined_resolution_is_max_of_both(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]
        assert rules["min_resolution"]["width"] == 1000
        assert rules["min_resolution"]["height"] == 1000

    def test_combined_file_size_is_min_of_both(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]
        assert rules["max_file_size_bytes"] == 10_485_760

    def test_combined_title_length_is_min_of_both(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]
        assert rules["max_title_length"] == 60

    def test_combined_additional_images_is_min_of_both(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]
        assert rules["max_additional_images"] == 10

    def test_combined_prohibited_keywords_is_union_of_both(self, fixture_data):
        wb_kw = set(fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]["prohibited_keywords"])
        ozon_kw = set(fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]["prohibited_keywords"])
        combined_kw = set(fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]["prohibited_keywords"])
        assert combined_kw == wb_kw | ozon_kw

    def test_combined_mandatory_fields_is_union_of_both(self, fixture_data):
        wb_fields = set(fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]["mandatory_fields"])
        ozon_fields = set(fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]["mandatory_fields"])
        combined_fields = set(fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]["mandatory_fields"])
        assert combined_fields == wb_fields | ozon_fields

    def test_combined_background_is_stricter(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]
        assert rules["background"] == "white_required"

    def test_combined_reference_images_max(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]
        assert rules["max_reference_images"] == 5

    def test_combined_accepted_formats(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]
        assert set(rules["accepted_formats"]) == {"image/jpeg", "image/png", "image/webp"}


class TestRulePrecedenceRegressionScenarios:
    """Validate regression scenario fixture data for rule precedence."""

    def test_900px_passes_wb_fails_ozon_fails_combined(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_900px_should_pass_wb_fail_ozon")
        assert s["wb_only"]["passes"] is True
        assert s["ozon_only"]["passes"] is False
        assert s["wb_ozon_combined"]["passes"] is False
        assert "strictest_rule_ozon_resolution" in s["wb_ozon_combined"]["reason"]

    def test_1000px_passes_all_modes(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "1000px_passes_both")
        assert s["wb_only"]["passes"] is True
        assert s["ozon_only"]["passes"] is True
        assert s["wb_ozon_combined"]["passes"] is True

    def test_wb_keyword_copia_flagged_in_wb_and_combined(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_keyword_not_in_ozon")
        assert s["wb_only"]["flagged"] is True
        assert s["ozon_only"]["flagged"] is False
        assert s["wb_ozon_combined"]["flagged"] is True

    def test_ozon_keyword_fake_flagged_in_ozon_and_combined(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "ozon_keyword_not_in_wb")
        assert s["wb_only"]["flagged"] is False
        assert s["ozon_only"]["flagged"] is True
        assert s["wb_ozon_combined"]["flagged"] is True

    def test_shared_keyword_replika_flagged_everywhere(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "both_prohibit_replika")
        assert s["wb_only"]["flagged"] is True
        assert s["ozon_only"]["flagged"] is True
        assert s["wb_ozon_combined"]["flagged"] is True

    def test_title_80_chars_fails_wb_and_combined(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_stricter_title_length")
        assert s["wb_only"]["passes"] is False
        assert s["ozon_only"]["passes"] is True
        assert s["wb_ozon_combined"]["passes"] is False

    def test_missing_category_fails_wb_and_combined(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_mandatory_category")
        assert s["wb_only"]["passes"] is False
        assert s["ozon_only"]["passes"] is True
        assert s["wb_ozon_combined"]["passes"] is False


class TestRulePrecedenceCrossValidation:
    """Cross-validate that combined rules are derivable from individual rules."""

    def test_combined_resolution_derivable(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]
        wb = rules["wildberries"]["min_resolution"]
        ozon = rules["ozon"]["min_resolution"]
        combined = rules["wb_ozon_strictest"]["min_resolution"]
        assert combined["width"] == max(wb["width"], ozon["width"])
        assert combined["height"] == max(wb["height"], ozon["height"])

    def test_combined_file_size_derivable(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]
        wb = rules["wildberries"]["max_file_size_bytes"]
        ozon = rules["ozon"]["max_file_size_bytes"]
        combined = rules["wb_ozon_strictest"]["max_file_size_bytes"]
        assert combined == min(wb, ozon)

    def test_combined_title_length_derivable(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]
        wb = rules["wildberries"]["max_title_length"]
        ozon = rules["ozon"]["max_title_length"]
        combined = rules["wb_ozon_strictest"]["max_title_length"]
        assert combined == min(wb, ozon)

    def test_combined_additional_images_derivable(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]
        wb = rules["wildberries"]["max_additional_images"]
        ozon = rules["ozon"]["max_additional_images"]
        combined = rules["wb_ozon_strictest"]["max_additional_images"]
        assert combined == min(wb, ozon)

    def test_combined_keywords_union_derivable(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]
        wb_kw = set(rules["wildberries"]["prohibited_keywords"])
        ozon_kw = set(rules["ozon"]["prohibited_keywords"])
        combined_kw = set(rules["wb_ozon_strictest"]["prohibited_keywords"])
        assert combined_kw == wb_kw | ozon_kw

    def test_combined_mandatory_fields_union_derivable(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]
        wb_f = set(rules["wildberries"]["mandatory_fields"])
        ozon_f = set(rules["ozon"]["mandatory_fields"])
        combined_f = set(rules["wb_ozon_strictest"]["mandatory_fields"])
        assert combined_f == wb_f | ozon_f

    def test_combined_background_stricter_derivable(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]
        wb_bg = rules["wildberries"]["background"]
        ozon_bg = rules["ozon"]["background"]
        combined_bg = rules["wb_ozon_strictest"]["background"]
        stricter = "white_required" if "white_required" in (wb_bg, ozon_bg) else wb_bg
        assert combined_bg == stricter
