"""
Marketplace rule precedence tests.

Covers:
- WB-only rule application
- Ozon-only rule application
- Combined WB+Ozon strictest-rule precedence
- Resolution, keyword, title length, mandatory field conflicts
"""
import pytest

from tests.cf_app.conftest import CARDFLOW_BASE_URL, CARDFLOW_ENDPOINTS


class TestWBOnlyRulePrecedence:
    """Tests that WB-only projects apply only Wildberries rules."""

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_wb_only_uses_wb_resolution_minimum(self, cardflow_up, fixture_data):
        """WB-only project should use 900x900 minimum, not 1000x1000."""
        rules = fixture_data.get("fixtures", {}).get("compliance_rules_wb", {})
        min_res = rules.get("min_image_resolution", {})
        assert min_res.get("width") == 900
        assert min_res.get("height") == 900

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_wb_only_uses_wb_title_length(self, cardflow_up, fixture_data):
        """WB-only project should use 60-char title limit."""
        rules = fixture_data.get("fixtures", {}).get("compliance_rules_wb", {})
        assert rules.get("max_title_length") == 60

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_wb_only_uses_wb_prohibited_keywords(self, cardflow_up, fixture_data):
        """WB-only should flag WB-specific keywords (подделка, копия, 18+, порно)."""
        rules = fixture_data.get("fixtures", {}).get("compliance_rules_wb", {})
        prohibited = rules.get("prohibited_keywords", [])
        assert "подделка" in prohibited
        assert "копия" in prohibited
        assert "18+" in prohibited
        assert "порно" in prohibited

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_wb_only_uses_wb_mandatory_fields(self, cardflow_up, fixture_data):
        """WB-only should require brand, category, name."""
        rules = fixture_data.get("fixtures", {}).get("compliance_rules_wb", {})
        mandatory = rules.get("mandatory_fields", [])
        assert "brand" in mandatory
        assert "category" in mandatory
        assert "name" in mandatory

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_wb_only_900px_image_passes(self, cardflow_up):
        """900x900 image should pass WB-only validation."""
        # TODO: POST /api/v1/projects with marketplaces=["wildberries"]
        # Upload 900x900 image, verify compliance passes
        pytest.skip("endpoints not available yet")

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_wb_only_keyword_not_flagged_for_ozon(self, cardflow_up):
        """Keyword 'фейк' should NOT be flagged in WB-only project."""
        # TODO: Create WB-only project with text containing 'фейк'
        # Verify no compliance flag for this keyword
        pytest.skip("endpoints not available yet")


class TestOzonOnlyRulePrecedence:
    """Tests that Ozon-only projects apply only Ozon rules."""

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_ozon_only_uses_ozon_resolution_minimum(self, cardflow_up, fixture_data):
        """Ozon-only project should use 1000x1000 minimum."""
        rules = fixture_data.get("fixtures", {}).get("compliance_rules_ozon", {})
        min_res = rules.get("min_image_resolution", {})
        assert min_res.get("width") == 1000
        assert min_res.get("height") == 1000

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_ozon_only_uses_ozon_title_length(self, cardflow_up, fixture_data):
        """Ozon-only project should use 120-char title limit."""
        rules = fixture_data.get("fixtures", {}).get("compliance_rules_ozon", {})
        assert rules.get("max_title_length") == 120

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_ozon_only_uses_ozon_prohibited_keywords(self, cardflow_up, fixture_data):
        """Ozon-only should flag Ozon-specific keywords (реплика, фейк)."""
        rules = fixture_data.get("fixtures", {}).get("compliance_rules_ozon", {})
        prohibited = rules.get("prohibited_keywords", [])
        assert "реплика" in prohibited
        assert "фейк" in prohibited

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_ozon_only_uses_ozon_mandatory_fields(self, cardflow_up, fixture_data):
        """Ozon-only should require only brand."""
        rules = fixture_data.get("fixtures", {}).get("compliance_rules_ozon", {})
        mandatory = rules.get("mandatory_fields", [])
        assert "brand" in mandatory
        assert "category" not in mandatory
        assert "name" not in mandatory

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_ozon_only_900px_image_fails(self, cardflow_up):
        """900x900 image should fail Ozon-only (needs 1000x1000)."""
        # TODO: Create Ozon-only project with 900x900 image
        # Verify compliance fails with resolution error
        pytest.skip("endpoints not available yet")

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_ozon_only_keyword_not_flagged_for_wb(self, cardflow_up):
        """Keyword 'копия' should NOT be flagged in Ozon-only project."""
        # TODO: Create Ozon-only project with text containing 'копия'
        # Verify no compliance flag for this keyword
        pytest.skip("endpoints not available yet")


class TestCombinedRulePrecedence:
    """Tests that WB+Ozon projects apply strictest rules from both."""

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_combined_uses_stricter_resolution(self, cardflow_up, fixture_data):
        """Combined project should use max(WB, Ozon) resolution = 1000x1000."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wb_ozon_strictest", {})
        min_res = rules.get("min_resolution", {})
        assert min_res.get("width") == 1000
        assert min_res.get("height") == 1000

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_combined_uses_stricter_title_length(self, cardflow_up, fixture_data):
        """Combined project should use min(WB=60, Ozon=120) = 60 chars."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wb_ozon_strictest", {})
        assert rules.get("max_title_length") == 60

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_combined_uses_union_prohibited_keywords(self, cardflow_up, fixture_data):
        """Combined project should flag keywords from BOTH marketplaces."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wb_ozon_strictest", {})
        prohibited = rules.get("prohibited_keywords", [])
        # WB-specific
        assert "подделка" in prohibited
        assert "копия" in prohibited
        assert "18+" in prohibited
        assert "порно" in prohibited
        # Ozon-specific
        assert "фейк" in prohibited
        # Shared
        assert "реплика" in prohibited

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_combined_uses_union_mandatory_fields(self, cardflow_up, fixture_data):
        """Combined project should require union of mandatory fields."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wb_ozon_strictest", {})
        mandatory = rules.get("mandatory_fields", [])
        assert "brand" in mandatory
        assert "category" in mandatory
        assert "name" in mandatory

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_combined_uses_stricter_file_size(self, cardflow_up, fixture_data):
        """Combined project should use min(WB=10MB, Ozon=20MB) = 10MB."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wb_ozon_strictest", {})
        assert rules.get("max_file_size_bytes") == 10485760

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_combined_uses_stricter_additional_images(self, cardflow_up, fixture_data):
        """Combined project should use min(WB=10, Ozon=15) = 10 additional images."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wb_ozon_strictest", {})
        assert rules.get("max_additional_images") == 10

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_combined_uses_stricter_background(self, cardflow_up, fixture_data):
        """Combined project should use white_required (Ozon is stricter)."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wb_ozon_strictest", {})
        assert rules.get("background") == "white_required"


class TestRulePrecedenceRegressionScenarios:
    """Regression scenarios from ingestion_fixtures.json."""

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_900px_passes_wb_fails_ozon_fails_combined(self, cardflow_up, fixture_data):
        """900x900 passes WB-only, fails Ozon-only, fails combined (strictest)."""
        scenario = None
        for s in fixture_data.get("ingestion_fixtures", {}).get("regression_scenarios", []):
            if s["id"] == "wb_900px_should_pass_wb_fail_ozon":
                scenario = s
                break
        assert scenario is not None
        assert scenario["wb_only"]["passes"] is True
        assert scenario["ozon_only"]["passes"] is False
        assert scenario["wb_ozon_combined"]["passes"] is False
        assert "strictest_rule_ozon_resolution" in scenario["wb_ozon_combined"]["reason"]

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_1000px_passes_all_modes(self, cardflow_up, fixture_data):
        """1000x1000 passes WB-only, Ozon-only, and combined."""
        scenario = None
        for s in fixture_data.get("ingestion_fixtures", {}).get("regression_scenarios", []):
            if s["id"] == "1000px_passes_both":
                scenario = s
                break
        assert scenario is not None
        assert scenario["wb_only"]["passes"] is True
        assert scenario["ozon_only"]["passes"] is True
        assert scenario["wb_ozon_combined"]["passes"] is True

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_wb_keyword_copia_flagged_in_combined(self, cardflow_up, fixture_data):
        """'копия' flagged in WB-only and combined, not in Ozon-only."""
        scenario = None
        for s in fixture_data.get("ingestion_fixtures", {}).get("regression_scenarios", []):
            if s["id"] == "wb_keyword_not_in_ozon":
                scenario = s
                break
        assert scenario is not None
        assert scenario["wb_only"]["flagged"] is True
        assert scenario["ozon_only"]["flagged"] is False
        assert scenario["wb_ozon_combined"]["flagged"] is True

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_ozon_keyword_fake_flagged_in_combined(self, cardflow_up, fixture_data):
        """'фейк' flagged in Ozon-only and combined, not in WB-only."""
        scenario = None
        for s in fixture_data.get("ingestion_fixtures", {}).get("regression_scenarios", []):
            if s["id"] == "ozon_keyword_not_in_wb":
                scenario = s
                break
        assert scenario is not None
        assert scenario["wb_only"]["flagged"] is False
        assert scenario["ozon_only"]["flagged"] is True
        assert scenario["wb_ozon_combined"]["flagged"] is True

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_shared_keyword_replika_flagged_everywhere(self, cardflow_up, fixture_data):
        """'реплика' flagged in all modes."""
        scenario = None
        for s in fixture_data.get("ingestion_fixtures", {}).get("regression_scenarios", []):
            if s["id"] == "both_prohibit_replika":
                scenario = s
                break
        assert scenario is not None
        assert scenario["wb_only"]["flagged"] is True
        assert scenario["ozon_only"]["flagged"] is True
        assert scenario["wb_ozon_combined"]["flagged"] is True

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_title_80_chars_fails_wb_and_combined(self, cardflow_up, fixture_data):
        """80-char title passes Ozon-only, fails WB-only and combined."""
        scenario = None
        for s in fixture_data.get("ingestion_fixtures", {}).get("regression_scenarios", []):
            if s["id"] == "wb_stricter_title_length":
                scenario = s
                break
        assert scenario is not None
        assert scenario["wb_only"]["passes"] is False
        assert scenario["ozon_only"]["passes"] is True
        assert scenario["wb_ozon_combined"]["passes"] is False

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_missing_category_fails_wb_and_combined(self, cardflow_up, fixture_data):
        """Missing 'category' field fails WB-only and combined, passes Ozon-only."""
        scenario = None
        for s in fixture_data.get("ingestion_fixtures", {}).get("regression_scenarios", []):
            if s["id"] == "wb_mandatory_category":
                scenario = s
                break
        assert scenario is not None
        assert scenario["wb_only"]["passes"] is False
        assert scenario["ozon_only"]["passes"] is True
        assert scenario["wb_ozon_combined"]["passes"] is False


class TestMarketplaceValidationReportPerMode:
    """Verify validation report contents per marketplace mode."""

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_wb_only_report_has_wb_section_only(self, cardflow_up):
        """WB-only compliance report should only have wildberries section."""
        # TODO: Create WB-only project, run compliance, check report
        pytest.skip("endpoints not available yet")

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_ozon_only_report_has_ozon_section_only(self, cardflow_up):
        """Ozon-only compliance report should only have ozon section."""
        # TODO: Create Ozon-only project, run compliance, check report
        pytest.skip("endpoints not available yet")

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_combined_report_has_both_sections(self, cardflow_up):
        """Combined compliance report should have both wildberries and ozon sections."""
        # TODO: Create WB+Ozon project, run compliance, check report
        pytest.skip("endpoints not available yet")

    @pytest.mark.skip(reason="upstream dev task 3f40bd18 not landed yet")
    def test_combined_report_shows_strictest_applied(self, cardflow_up):
        """Combined report should indicate strictest rules were applied."""
        # TODO: Verify report metadata shows strictest rule application
        pytest.skip("endpoints not available yet")
