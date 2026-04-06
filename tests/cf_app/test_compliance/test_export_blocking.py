"""
Critical-failure export blocking tests — fixture-based (no API needed).

Covers:
- Export blocked when compliance has critical failures
- Export blocked when stages are not fully approved
- Export blocked when cards are not all approved
- Export allowed when all conditions are met
- Export behavior with warning-level (non-critical) issues
- WB-only, Ozon-only, and combined export blocking scenarios
"""
import pytest


class TestExportBlockedByCriticalCompliance:
    """Tests that critical compliance failures block export."""

    def test_export_blocked_with_critical_compliance_failures(self, fixture_data):
        error_flow = None
        for ef in fixture_data["workflow_fixtures"]["error_flow_scenarios"]:
            if ef["scenario"] == "export_compliance_failure":
                error_flow = ef
                break
        assert error_flow is not None
        assert error_flow["expected_status"] == 403
        assert "critical" in error_flow["expected_error"].lower()

    def test_export_blocked_message_includes_failure_count(self, fixture_data):
        error_flow = None
        for ef in fixture_data["workflow_fixtures"]["error_flow_scenarios"]:
            if ef["scenario"] == "export_compliance_failure":
                error_flow = ef
                break
        assert error_flow is not None
        state = error_flow.get("state", {})
        compliance = state.get("compliance", {})
        failures = compliance.get("failures", 0)
        assert failures == 3
        assert str(failures) in error_flow["expected_error"]

    def test_export_blocked_compliance_has_critical_severity(self, fixture_data):
        error_flow = None
        for ef in fixture_data["workflow_fixtures"]["error_flow_scenarios"]:
            if ef["scenario"] == "export_compliance_failure":
                error_flow = ef
                break
        assert error_flow is not None
        compliance = error_flow["state"]["compliance"]
        assert compliance["severity"] == "critical"

    def test_export_blocked_compliance_score_below_threshold(self, fixture_data):
        error_flow = None
        for ef in fixture_data["workflow_fixtures"]["error_flow_scenarios"]:
            if ef["scenario"] == "export_compliance_failure":
                error_flow = ef
                break
        assert error_flow is not None
        score = error_flow["state"]["compliance"]["score"]
        critical_max = fixture_data["ingestion_fixtures"]["quality_thresholds"]["critical"]["max_score"]
        assert score <= critical_max

    def test_export_blocked_wb_prohibited_keyword_scenario(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]
        assert "подделка" in rules["prohibited_keywords"]

    def test_export_blocked_ozon_prohibited_keyword_scenario(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert "фейк" in rules["prohibited_keywords"]

    def test_export_blocked_combined_either_violation(self, fixture_data):
        combined_kw = set(fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]["prohibited_keywords"])
        wb_kw = set(fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]["prohibited_keywords"])
        ozon_kw = set(fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]["prohibited_keywords"])
        assert wb_kw.issubset(combined_kw)
        assert ozon_kw.issubset(combined_kw)


class TestExportBlockedByApprovalState:
    """Tests that incomplete approval state blocks export."""

    def test_export_blocked_unapproved_review_stage(self, fixture_data):
        error_flow = None
        for ef in fixture_data["workflow_fixtures"]["error_flow_scenarios"]:
            if ef["scenario"] == "export_unapproved_project":
                error_flow = ef
                break
        assert error_flow is not None
        assert error_flow["expected_status"] == 403
        assert "blocked" in error_flow["expected_error"].lower()

    def test_export_blocked_unapproved_earlier_stage(self, fixture_data):
        error_flow = None
        for ef in fixture_data["workflow_fixtures"]["error_flow_scenarios"]:
            if ef["scenario"] == "stage_transition_unapproved_predecessor":
                error_flow = ef
                break
        assert error_flow is not None
        assert error_flow["expected_status"] == 409

    def test_export_blocked_partial_card_approval(self, fixture_data):
        partial = None
        for pa in fixture_data["workflow_fixtures"]["partial_approval_scenarios"]:
            if pa["scenario"] == "half_cards_approved_in_stage":
                partial = pa
                break
        assert partial is not None
        assert partial["export_allowed"] is False
        assert partial["draft_count"] == 1

    def test_partial_approval_has_correct_counts(self, fixture_data):
        partial = None
        for pa in fixture_data["workflow_fixtures"]["partial_approval_scenarios"]:
            if pa["scenario"] == "half_cards_approved_in_stage":
                partial = pa
                break
        assert partial is not None
        assert partial["approved_count"] == 5
        assert partial["pending_count"] == 2
        assert partial["draft_count"] == 1
        total = partial["approved_count"] + partial["pending_count"] + partial["draft_count"]
        assert total == 8

    def test_partial_approval_stage_status(self, fixture_data):
        partial = None
        for pa in fixture_data["workflow_fixtures"]["partial_approval_scenarios"]:
            if pa["scenario"] == "half_cards_approved_in_stage":
                partial = pa
                break
        assert partial is not None
        assert partial["expected_stage_status"] == "partially_approved"

    def test_partial_approval_export_blocked_reason(self, fixture_data):
        partial = None
        for pa in fixture_data["workflow_fixtures"]["partial_approval_scenarios"]:
            if pa["scenario"] == "half_cards_approved_in_stage":
                partial = pa
                break
        assert partial is not None
        assert "Not all cards" in partial["reason"]


class TestExportAllowedWhenAllConditionsMet:
    """Tests that export succeeds when all conditions are satisfied."""

    def test_export_allowed_all_cards_approved(self, fixture_data):
        partial = None
        for pa in fixture_data["workflow_fixtures"]["partial_approval_scenarios"]:
            if pa["scenario"] == "all_cards_approved_export_ready":
                partial = pa
                break
        assert partial is not None
        assert partial["export_allowed"] is True
        assert partial["approved_count"] == 8
        assert partial["compliance_required"] is True

    def test_all_cards_approved_stage_status(self, fixture_data):
        partial = None
        for pa in fixture_data["workflow_fixtures"]["partial_approval_scenarios"]:
            if pa["scenario"] == "all_cards_approved_export_ready":
                partial = pa
                break
        assert partial is not None
        assert partial["expected_stage_status"] == "approved"

    def test_all_cards_approved_all_are_approved(self, fixture_data):
        partial = None
        for pa in fixture_data["workflow_fixtures"]["partial_approval_scenarios"]:
            if pa["scenario"] == "all_cards_approved_export_ready":
                partial = pa
                break
        assert partial is not None
        for card in partial["cards"]:
            assert card["status"] == "approved"

    def test_wb_only_upload_scenario_allows_export(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        assert scenario["expected_analysis"]["can_approve"] is True

    def test_combined_upload_scenario_allows_export(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_ozon"]
        assert scenario["expected_analysis"]["can_approve"] is True


class TestExportPackageContents:
    """Tests that export package fixture data is correct."""

    def test_export_package_format_is_zip(self, fixture_data):
        export_pkg = fixture_data["workflow_fixtures"]["export_package"]
        assert export_pkg["format"] == "zip"

    def test_export_package_contains_cards(self, fixture_data):
        export_pkg = fixture_data["workflow_fixtures"]["export_package"]
        contents = export_pkg["contents"]
        card_files = [c for c in contents if c.get("file", "").startswith("cards/")]
        assert len(card_files) > 0

    def test_export_package_contains_metadata(self, fixture_data):
        export_pkg = fixture_data["workflow_fixtures"]["export_package"]
        contents = export_pkg["contents"]
        metadata_files = [c for c in contents if c.get("file") == "metadata.json"]
        assert len(metadata_files) == 1

    def test_metadata_has_required_fields(self, fixture_data):
        export_pkg = fixture_data["workflow_fixtures"]["export_package"]
        contents = export_pkg["contents"]
        metadata = next(c for c in contents if c.get("file") == "metadata.json")
        required_fields = {"title", "description", "bullet_points", "category", "attributes"}
        assert required_fields.issubset(set(metadata["fields"]))

    def test_wb_export_respects_wb_limits(self, fixture_data):
        export_pkg = fixture_data["workflow_fixtures"]["export_package"]
        wb_limits = export_pkg["marketplace_specific"]["wildberries"]
        assert wb_limits["max_files"] == 10
        assert wb_limits["max_size_mb"] == 10
        assert set(wb_limits["formats"]) == {"png", "jpg"}

    def test_ozon_export_respects_ozon_limits(self, fixture_data):
        export_pkg = fixture_data["workflow_fixtures"]["export_package"]
        ozon_limits = export_pkg["marketplace_specific"]["ozon"]
        assert ozon_limits["max_files"] == 15
        assert ozon_limits["max_size_mb"] == 20
        assert set(ozon_limits["formats"]) == {"png", "jpg", "webp"}

    def test_ozon_allows_webp_but_wb_does_not(self, fixture_data):
        export_pkg = fixture_data["workflow_fixtures"]["export_package"]
        wb_formats = set(export_pkg["marketplace_specific"]["wildberries"]["formats"])
        ozon_formats = set(export_pkg["marketplace_specific"]["ozon"]["formats"])
        assert "webp" in ozon_formats
        assert "webp" not in wb_formats

    def test_ozon_has_higher_limits_than_wb(self, fixture_data):
        export_pkg = fixture_data["workflow_fixtures"]["export_package"]
        wb = export_pkg["marketplace_specific"]["wildberries"]
        ozon = export_pkg["marketplace_specific"]["ozon"]
        assert ozon["max_files"] > wb["max_files"]
        assert ozon["max_size_mb"] > wb["max_size_mb"]


class TestExportBlockingRegressionScenarios:
    """Regression scenarios for export blocking behavior."""

    def test_critical_score_35_blocks_approval(self, fixture_data):
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        assert 35 <= thresholds["critical"]["max_score"]
        assert thresholds["critical"]["severity"] == "critical"

    def test_warning_score_65_allows_approval(self, fixture_data):
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        assert thresholds["acceptable"]["min_score"] <= 65 <= thresholds["acceptable"]["max_score"]
        assert thresholds["acceptable"]["severity"] == "warning"

    def test_warning_score_50_allows_approval(self, fixture_data):
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        assert thresholds["poor"]["min_score"] <= 50 <= thresholds["poor"]["max_score"]
        assert thresholds["poor"]["severity"] == "warning"

    def test_export_package_card_resolution(self, fixture_data):
        export_pkg = fixture_data["workflow_fixtures"]["export_package"]
        for item in export_pkg["contents"]:
            if item["file"].startswith("cards/"):
                assert "resolution" in item
                assert item["resolution"] == "3000x3000"
