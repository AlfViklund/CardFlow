"""
Review action scenario tests — fixture-based (no API needed).

Covers:
- Approve action (with and without warnings)
- Comment action (with requires_regenerate flag)
- Regenerate action (stage, card, element level)
- Review actions across WB-only, Ozon-only, and combined projects
- Full pipeline scenario tests for each marketplace mode
"""
import pytest


class TestApproveAction:
    """Tests for the approve review action fixture data."""

    def test_approve_stage_changes_status_to_approved(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "approve_with_warning_comment":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["stage_status"] == "approved"

    def test_approve_with_warning_attaches_warning(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "approve_with_warning_comment":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["warning_attached"] is True

    def test_approve_with_warning_unblocks_downstream(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "approve_with_warning_comment":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["downstream_unblocked"] is True

    def test_approve_with_warning_sets_export_flag(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "approve_with_warning_comment":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["export_flag"] == "warning_pending"

    def test_approve_single_card_updates_card_status(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "approve_single_card_in_stage":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["card_5_status"] == "approved"

    def test_approve_card_records_timestamp(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "approve_single_card_in_stage":
                scenario = s
                break
        assert scenario is not None
        assert "card_5_approved_at" in scenario["expected"]

    def test_approve_scenario_prior_state_is_pending_review(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "approve_with_warning_comment":
                scenario = s
                break
        assert scenario is not None
        assert scenario["prior_state"]["stage_status"] == "pending_review"


class TestCommentAction:
    """Tests for the comment review action fixture data."""

    def test_comment_with_requires_regenerate_blocks_downstream(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "reject_with_required_changes":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["downstream_blocked"] is True

    def test_comment_with_requires_regenerate_sets_needs_revision(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "reject_with_required_changes":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["stage_status"] == "needs_revision"

    def test_comment_with_requires_regenerate_flags_regeneration_required(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "reject_with_required_changes":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["regeneration_required"] is True

    def test_comment_scenario_has_requires_regenerate_param(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "reject_with_required_changes":
                scenario = s
                break
        assert scenario is not None
        assert scenario["params"]["requires_regenerate"] is True

    def test_comment_scenario_has_comment_text(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "reject_with_required_changes":
                scenario = s
                break
        assert scenario is not None
        assert "comment" in scenario["params"]
        assert len(scenario["params"]["comment"]) > 0


class TestRegenerateAction:
    """Tests for the regenerate action fixture data."""

    def test_regenerate_stage_creates_new_revisions_for_all_cards(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["regeneration_scenarios"]:
            if s["target"] == "whole_stage":
                scenario = s
                break
        assert scenario is not None
        assert "8 new cards" in scenario["expected"]

    def test_regenerate_single_card_only_affects_that_card(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["regeneration_scenarios"]:
            if s["target"] == "single_card":
                scenario = s
                break
        assert scenario is not None
        assert "siblings unchanged" in scenario["expected"]

    def test_regenerate_element_preserves_other_elements(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["regeneration_scenarios"]:
            if s["target"] == "element":
                scenario = s
                break
        assert scenario is not None
        assert "background and layout preserved" in scenario["expected"]

    def test_regenerate_unapproved_stage_requires_force_flag(self, fixture_data):
        error_flow = None
        for ef in fixture_data["workflow_fixtures"]["error_flow_scenarios"]:
            if ef["scenario"] == "regenerate_unapproved_stage":
                error_flow = ef
                break
        assert error_flow is not None
        assert error_flow["expected_status"] == 400

    def test_regenerate_invalid_element_returns_422(self, fixture_data):
        error_flow = None
        for ef in fixture_data["workflow_fixtures"]["error_flow_scenarios"]:
            if ef["scenario"] == "regenerate_invalid_element":
                error_flow = ef
                break
        assert error_flow is not None
        assert error_flow["expected_status"] == 422

    def test_regenerate_valid_elements(self, fixture_data):
        valid_elements = ["text_overlay", "background", "badge", "icon", "position"]
        error_flow = None
        for ef in fixture_data["workflow_fixtures"]["error_flow_scenarios"]:
            if ef["scenario"] == "regenerate_invalid_element":
                error_flow = ef
                break
        assert error_flow is not None
        for elem in valid_elements:
            assert elem in error_flow["expected_error"]

    def test_regenerate_approved_card_downgrades_stage(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["partial_approval_scenarios"]:
            if s["scenario"] == "regenerate_single_approved_card":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["stage_status_downgraded"] == "partially_approved"

    def test_regenerate_increments_revision_number(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["partial_approval_scenarios"]:
            if s["scenario"] == "regenerate_single_approved_card":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["card_3_revision"] == 2

    def test_regenerate_element_target_has_element_field(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["regeneration_scenarios"]:
            if s["target"] == "element":
                scenario = s
                break
        assert scenario is not None
        assert "element" in scenario
        assert scenario["element"] == "text_overlay"

    def test_regenerate_single_card_has_card_id(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["regeneration_scenarios"]:
            if s["target"] == "single_card":
                scenario = s
                break
        assert scenario is not None
        assert scenario["card_id"] == 3


class TestReviewActionsAcrossMarketplaceModes:
    """Tests review action scenarios cover all marketplace modes."""

    def test_wb_only_scenario_has_wb_marketplace(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        assert scenario["marketplaces"] == ["wildberries"]

    def test_combined_scenario_has_both_marketplaces(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_ozon"]
        assert set(scenario["marketplaces"]) == {"wildberries", "ozon"}

    def test_main_plus_brief_scenario_is_wb_only(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["main_plus_brief"]
        assert scenario["marketplaces"] == ["wildberries"]

    def test_workflow_stages_support_all_review_actions(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        review_stage = next(s for s in stages if s["name"] == "review")
        assert "approval" in review_stage["outputs"]
        assert "comments" in review_stage["outputs"]
        assert "regeneration_requests" in review_stage["outputs"]


class TestPipelineScenarioWBOnly:
    """WB-only pipeline scenario validation."""

    def test_wb_only_scenario_has_required_files(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        assert "main" in scenario["files"]
        assert "additional" in scenario["files"]
        assert "references" in scenario["files"]

    def test_wb_only_scenario_has_brief(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        assert "brief" in scenario
        assert len(scenario["brief"]) > 0

    def test_wb_only_scenario_quality_score_excellent(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        score = scenario["expected_analysis"]["quality_score"]
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        assert score >= thresholds["excellent"]["min_score"]

    def test_wb_only_scenario_can_approve(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        assert scenario["expected_analysis"]["can_approve"] is True


class TestPipelineScenarioOzonOnly:
    """Ozon-only pipeline scenario validation."""

    def test_ozon_rules_require_1000px_minimum(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert rules["min_resolution"]["width"] == 1000
        assert rules["min_resolution"]["height"] == 1000

    def test_900px_fails_ozon_only(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_900px_should_pass_wb_fail_ozon")
        assert s["ozon_only"]["passes"] is False
        assert s["ozon_only"]["can_approve"] is False

    def test_1000px_passes_ozon_only(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "1000px_passes_both")
        assert s["ozon_only"]["passes"] is True
        assert s["ozon_only"]["can_approve"] is True


class TestPipelineScenarioCombined:
    """Combined WB+Ozon pipeline scenario validation."""

    def test_combined_scenario_has_strictest_rules_flag(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_ozon"]
        assert scenario["strictest_rules"] is True

    def test_combined_scenario_quality_score_excellent(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_ozon"]
        score = scenario["expected_analysis"]["quality_score"]
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        assert score >= thresholds["excellent"]["min_score"]

    def test_combined_scenario_can_approve(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_ozon"]
        assert scenario["expected_analysis"]["can_approve"] is True

    def test_combined_regression_900px_fails(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_900px_should_pass_wb_fail_ozon")
        assert s["wb_ozon_combined"]["passes"] is False

    def test_combined_regression_1000px_passes(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "1000px_passes_both")
        assert s["wb_ozon_combined"]["passes"] is True


class TestCommentThenRegenerateFlow:
    """Tests the comment → regenerate pipeline flow."""

    def test_comment_sets_needs_revision(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "reject_with_required_changes":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["stage_status"] == "needs_revision"
        assert scenario["expected"]["regeneration_required"] is True

    def test_regenerate_whole_stage_is_valid_target(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["regeneration_scenarios"]:
            if s["target"] == "whole_stage":
                scenario = s
                break
        assert scenario is not None
        assert scenario["stage"] == "design_concepts"

    def test_regenerate_single_card_is_valid_target(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["regeneration_scenarios"]:
            if s["target"] == "single_card":
                scenario = s
                break
        assert scenario is not None
        assert scenario["card_id"] == 3


class TestApproveAfterRegenerateFlow:
    """Tests the regenerate → approve pipeline flow."""

    def test_regenerate_approved_card_downgrades_to_partially_approved(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["partial_approval_scenarios"]:
            if s["scenario"] == "regenerate_single_approved_card":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["stage_status_downgraded"] == "partially_approved"

    def test_regenerate_increments_revision(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["partial_approval_scenarios"]:
            if s["scenario"] == "regenerate_single_approved_card":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["card_3_revision"] == 2
        assert scenario["prior_state"]["card_3_revision"] == 1

    def test_regenerate_sets_card_to_pending_review(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["partial_approval_scenarios"]:
            if s["scenario"] == "regenerate_single_approved_card":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["card_3_status"] == "pending_review"

    def test_regenerate_preserves_siblings(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["regeneration_scenarios"]:
            if s["target"] == "single_card":
                scenario = s
                break
        assert scenario is not None
        assert "siblings unchanged" in scenario["expected"]
