"""
Scenario-based E2E tests — fixture-based (no API needed).

Covers full pipeline paths for WB-only, Ozon-only, and combined projects:
- Upload → Analyze → Approve → Generate → Review → Export
- With approve, comment, and regenerate flows at review stage
- Cross-mode comparison scenarios
"""
import pytest


# ── WB-Only Scenarios ───────────────────────────────────────────────

class TestWBOnlyHappyPath:
    """WB-only project: clean path from upload to export."""

    def test_wb_only_scenario_has_valid_main_image(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        main = scenario["files"]["main"]
        assert main["dimensions"]["width"] >= 900
        assert main["dimensions"]["height"] >= 900
        assert main["content_type"] == "image/jpeg"

    def test_wb_only_scenario_has_additional_images(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        assert len(scenario["files"]["additional"]) == 3
        for img in scenario["files"]["additional"]:
            assert img["dimensions"]["width"] >= 900
            assert img["dimensions"]["height"] >= 900

    def test_wb_only_scenario_has_references(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        assert len(scenario["files"]["references"]) == 2

    def test_wb_only_scenario_analysis_succeeds(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        analysis = scenario["expected_analysis"]
        assert analysis["status"] == "success"
        assert analysis["can_approve"] is True
        assert analysis["flags"] == []

    def test_wb_only_scenario_quality_score_excellent(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        score = scenario["expected_analysis"]["quality_score"]
        assert score >= 90

    def test_wb_only_scenario_has_no_flags(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        assert scenario["expected_analysis"]["flags"] == []

    def test_wb_only_scenario_references_wb_rules(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        assert scenario["expected_analysis"]["marketplace_rules"] == "wb"


class TestWBOnlyWarningPath:
    """WB-only project: path with warnings that still allows export."""

    def test_wb_only_warning_non_square_aspect(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "warning_non_square_allows")
        assert case["severity"] == "warning"
        assert case["can_approve"] is True
        assert case["should_block_pipeline"] is False

    def test_wb_only_warning_transparency(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "warning_transparency_allows")
        assert case["severity"] == "warning"
        assert case["can_approve"] is True
        assert case["should_block_pipeline"] is False

    def test_wb_only_warning_empty_brief(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "warning_empty_brief_allows")
        assert case["severity"] == "warning"
        assert case["can_approve"] is True
        assert case["should_block_pipeline"] is False


class TestWBOnlyCriticalBlockPath:
    """WB-only project: critical compliance failure blocks pipeline."""

    def test_wb_only_critical_prohibited_keyword(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]
        assert "подделка" in rules["prohibited_keywords"]
        assert "копия" in rules["prohibited_keywords"]

    def test_wb_only_critical_low_resolution(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "critical_resolution_blocks")
        assert case["severity"] == "critical"
        assert case["can_approve"] is False
        assert case["should_block_pipeline"] is True

    def test_wb_only_critical_missing_main(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "critical_missing_main_blocks")
        assert case["severity"] == "critical"
        assert case["can_approve"] is False
        assert case["should_block_pipeline"] is True


# ── Ozon-Only Scenarios ─────────────────────────────────────────────

class TestOzonOnlyHappyPath:
    """Ozon-only project: clean path from upload to export."""

    def test_ozon_rules_require_1000px(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert rules["min_resolution"]["width"] == 1000
        assert rules["min_resolution"]["height"] == 1000

    def test_ozon_allows_larger_files(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert rules["max_file_size_bytes"] == 20_971_520

    def test_ozon_allows_longer_titles(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert rules["max_title_length"] == 120

    def test_ozon_requires_white_background(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert rules["background"] == "white_required"

    def test_ozon_only_brand_mandatory(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert set(rules["mandatory_fields"]) == {"brand"}


class TestOzonOnlyCriticalBlockPath:
    """Ozon-only project: critical compliance failure blocks pipeline."""

    def test_ozon_only_critical_prohibited_keyword(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]
        assert "фейк" in rules["prohibited_keywords"]
        assert "реплика" in rules["prohibited_keywords"]

    def test_ozon_only_900px_fails(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_900px_should_pass_wb_fail_ozon")
        assert s["ozon_only"]["passes"] is False
        assert s["ozon_only"]["can_approve"] is False

    def test_ozon_only_does_not_flag_wb_specific_keyword(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_keyword_not_in_ozon")
        assert s["ozon_only"]["flagged"] is False
        assert s["ozon_only"]["can_approve"] is True


class TestOzonOnlyCommentRegeneratePath:
    """Ozon-only project: comment → regenerate → approve path."""

    def test_comment_reject_sets_needs_revision(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["review_action_scenarios"]:
            if s["scenario"] == "reject_with_required_changes":
                scenario = s
                break
        assert scenario is not None
        assert scenario["expected"]["stage_status"] == "needs_revision"
        assert scenario["expected"]["regeneration_required"] is True
        assert scenario["expected"]["downstream_blocked"] is True

    def test_regenerate_design_concepts_valid(self, fixture_data):
        scenario = None
        for s in fixture_data["workflow_fixtures"]["regeneration_scenarios"]:
            if s["target"] == "whole_stage":
                scenario = s
                break
        assert scenario is not None
        assert scenario["stage"] == "design_concepts"


# ── Combined (WB+Ozon) Scenarios ────────────────────────────────────

class TestCombinedHappyPath:
    """Combined WB+Ozon project: clean path from upload to export."""

    def test_combined_scenario_has_strictest_rules(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_ozon"]
        assert scenario["strictest_rules"] is True
        assert scenario["expected_analysis"]["marketplace_rules"] == "wb+ozon_strictest"

    def test_combined_scenario_quality_score_excellent(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_ozon"]
        score = scenario["expected_analysis"]["quality_score"]
        assert score >= 90

    def test_combined_scenario_can_approve(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_ozon"]
        assert scenario["expected_analysis"]["can_approve"] is True

    def test_combined_uses_max_resolution(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]
        assert rules["min_resolution"]["width"] == 1000
        assert rules["min_resolution"]["height"] == 1000

    def test_combined_uses_min_title_length(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]
        assert rules["max_title_length"] == 60

    def test_combined_uses_union_keywords(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]
        wb_kw = set(fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]["prohibited_keywords"])
        ozon_kw = set(fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]["prohibited_keywords"])
        assert set(rules["prohibited_keywords"]) == wb_kw | ozon_kw

    def test_combined_uses_union_mandatory_fields(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]
        wb_f = set(fixture_data["ingestion_fixtures"]["marketplace_rules"]["wildberries"]["mandatory_fields"])
        ozon_f = set(fixture_data["ingestion_fixtures"]["marketplace_rules"]["ozon"]["mandatory_fields"])
        assert set(rules["mandatory_fields"]) == wb_f | ozon_f


class TestCombinedCriticalBlockPath:
    """Combined project: critical compliance failure blocks export."""

    def test_combined_wb_keyword_blocks(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_keyword_not_in_ozon")
        assert s["wb_ozon_combined"]["flagged"] is True
        assert s["wb_ozon_combined"]["can_approve"] is False

    def test_combined_ozon_keyword_blocks(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "ozon_keyword_not_in_wb")
        assert s["wb_ozon_combined"]["flagged"] is True
        assert s["wb_ozon_combined"]["can_approve"] is False

    def test_combined_shared_keyword_blocks(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "both_prohibit_replika")
        assert s["wb_ozon_combined"]["flagged"] is True
        assert s["wb_ozon_combined"]["can_approve"] is False

    def test_combined_title_too_long_blocks(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_stricter_title_length")
        assert s["wb_ozon_combined"]["passes"] is False
        assert s["wb_ozon_combined"]["can_approve"] is False

    def test_combined_missing_wb_field_blocks(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_mandatory_category")
        assert s["wb_ozon_combined"]["passes"] is False
        assert s["wb_ozon_combined"]["can_approve"] is False


class TestCombinedCommentRegeneratePath:
    """Combined project: comment → regenerate → approve path."""

    def test_combined_regenerate_respects_stricter_rules(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]["wb_ozon_strictest"]
        assert rules["min_resolution"]["width"] == 1000
        assert rules["max_title_length"] == 60
        assert len(rules["prohibited_keywords"]) == 6

    def test_combined_workflow_has_review_stage(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        review = next(s for s in stages if s["name"] == "review")
        assert review["stage"] == 5
        assert "approval" in review["outputs"]
        assert "comments" in review["outputs"]
        assert "regeneration_requests" in review["outputs"]


# ── Cross-Mode Comparison Scenarios ─────────────────────────────────

class TestCrossModeComparison:
    """Compare behavior across WB-only, Ozon-only, and combined modes."""

    def test_900px_passes_wb_fails_ozon_fails_combined(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_900px_should_pass_wb_fail_ozon")
        assert s["wb_only"]["passes"] is True
        assert s["ozon_only"]["passes"] is False
        assert s["wb_ozon_combined"]["passes"] is False

    def test_1000px_passes_all_modes(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "1000px_passes_both")
        assert s["wb_only"]["passes"] is True
        assert s["ozon_only"]["passes"] is True
        assert s["wb_ozon_combined"]["passes"] is True

    def test_wb_keyword_flagged_in_wb_and_combined_not_ozon(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_keyword_not_in_ozon")
        assert s["wb_only"]["flagged"] is True
        assert s["ozon_only"]["flagged"] is False
        assert s["wb_ozon_combined"]["flagged"] is True

    def test_ozon_keyword_flagged_in_ozon_and_combined_not_wb(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "ozon_keyword_not_in_wb")
        assert s["wb_only"]["flagged"] is False
        assert s["ozon_only"]["flagged"] is True
        assert s["wb_ozon_combined"]["flagged"] is True

    def test_shared_keyword_flagged_everywhere(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "both_prohibit_replika")
        assert s["wb_only"]["flagged"] is True
        assert s["ozon_only"]["flagged"] is True
        assert s["wb_ozon_combined"]["flagged"] is True

    def test_title_80_chars_fails_wb_and_combined_passes_ozon(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_stricter_title_length")
        assert s["wb_only"]["passes"] is False
        assert s["ozon_only"]["passes"] is True
        assert s["wb_ozon_combined"]["passes"] is False

    def test_missing_category_fails_wb_and_combined_passes_ozon(self, fixture_data):
        scenarios = fixture_data["ingestion_fixtures"]["regression_scenarios"]
        s = next(x for x in scenarios if x["id"] == "wb_mandatory_category")
        assert s["wb_only"]["passes"] is False
        assert s["ozon_only"]["passes"] is True
        assert s["wb_ozon_combined"]["passes"] is False

    def test_combined_has_more_or_equal_prohibited_keywords(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]
        wb_count = len(rules["wildberries"]["prohibited_keywords"])
        ozon_count = len(rules["ozon"]["prohibited_keywords"])
        combined_count = len(rules["wb_ozon_strictest"]["prohibited_keywords"])
        assert combined_count >= wb_count
        assert combined_count >= ozon_count

    def test_combined_has_more_or_equal_mandatory_fields(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]
        wb_count = len(rules["wildberries"]["mandatory_fields"])
        ozon_count = len(rules["ozon"]["mandatory_fields"])
        combined_count = len(rules["wb_ozon_strictest"]["mandatory_fields"])
        assert combined_count >= wb_count
        assert combined_count >= ozon_count

    def test_combined_has_stricter_or_equal_resolution(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]
        wb_min = rules["wildberries"]["min_resolution"]["width"]
        ozon_min = rules["ozon"]["min_resolution"]["width"]
        combined_min = rules["wb_ozon_strictest"]["min_resolution"]["width"]
        assert combined_min == max(wb_min, ozon_min)

    def test_combined_has_stricter_or_equal_title_length(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]
        wb_max = rules["wildberries"]["max_title_length"]
        ozon_max = rules["ozon"]["max_title_length"]
        combined_max = rules["wb_ozon_strictest"]["max_title_length"]
        assert combined_max == min(wb_max, ozon_max)


class TestPipelineStageValidation:
    """Validate workflow stage definitions."""

    def test_workflow_has_7_stages(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        assert len(stages) == 7

    def test_stages_are_sequential(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        for i, stage in enumerate(stages):
            assert stage["stage"] == i

    def test_stage_0_is_input_analysis(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        assert stages[0]["name"] == "input_analysis"
        assert "main_image" in stages[0]["accepts"]
        assert "category" in stages[0]["outputs"]

    def test_stage_5_is_review(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        review = next(s for s in stages if s["name"] == "review")
        assert review["stage"] == 5
        assert "approval" in review["outputs"]
        assert "comments" in review["outputs"]
        assert "regeneration_requests" in review["outputs"]

    def test_stage_6_is_export(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        export = next(s for s in stages if s["name"] == "export")
        assert export["stage"] == 6
        assert "approved_final_cards" in export["accepts"]
        assert "marketplace_export_package" in export["outputs"]

    def test_final_generation_has_8_cards(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        assert len(artifact["cards"]) == 8

    def test_all_cards_have_required_fields(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        for card in artifact["cards"]:
            assert "card_id" in card
            assert "scene_id" in card
            assert "design_variant" in card
            assert "status" in card
            assert "revision" in card

    def test_card_ids_are_sequential(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        card_ids = [c["card_id"] for c in artifact["cards"]]
        assert card_ids == list(range(1, 9))

    def test_scene_ids_are_sequential(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        scene_ids = [c["scene_id"] for c in artifact["cards"]]
        assert scene_ids == list(range(1, 9))

    def test_all_cards_start_at_revision_1(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        for card in artifact["cards"]:
            assert card["revision"] == 1

    def test_all_cards_start_as_generated(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        for card in artifact["cards"]:
            assert card["status"] == "generated"
