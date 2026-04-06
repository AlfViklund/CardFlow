"""
Compliance scoring tests — fixture-based (no API needed).

Covers:
- Quality score thresholds (excellent/good/acceptable/poor/critical)
- Score computation for WB-only, Ozon-only, and combined projects
- Score impact on approval and export decisions
- Threshold boundary conditions
"""
import pytest


class TestQualityScoreThresholds:
    """Tests that quality score thresholds are correctly defined."""

    def test_excellent_threshold_min_90(self, fixture_data):
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        assert thresholds["excellent"]["min_score"] == 90
        assert thresholds["excellent"]["severity"] == "pass"

    def test_good_threshold_range_75_to_89(self, fixture_data):
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        assert thresholds["good"]["min_score"] == 75
        assert thresholds["good"]["max_score"] == 89
        assert thresholds["good"]["severity"] == "pass"

    def test_acceptable_threshold_range_60_to_74(self, fixture_data):
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        assert thresholds["acceptable"]["min_score"] == 60
        assert thresholds["acceptable"]["max_score"] == 74
        assert thresholds["acceptable"]["severity"] == "warning"

    def test_poor_threshold_range_40_to_59(self, fixture_data):
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        assert thresholds["poor"]["min_score"] == 40
        assert thresholds["poor"]["max_score"] == 59
        assert thresholds["poor"]["severity"] == "warning"

    def test_critical_threshold_max_39(self, fixture_data):
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        assert thresholds["critical"]["max_score"] == 39
        assert thresholds["critical"]["severity"] == "critical"

    def test_thresholds_cover_full_0_to_100_range(self, fixture_data):
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        assert thresholds["critical"]["max_score"] + 1 == thresholds["poor"]["min_score"]
        assert thresholds["poor"]["max_score"] + 1 == thresholds["acceptable"]["min_score"]
        assert thresholds["acceptable"]["max_score"] + 1 == thresholds["good"]["min_score"]
        assert thresholds["good"]["max_score"] + 1 == thresholds["excellent"]["min_score"]

    def test_no_gap_between_thresholds(self, fixture_data):
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        ordered = ["critical", "poor", "acceptable", "good", "excellent"]
        for i in range(len(ordered) - 1):
            current_max = thresholds[ordered[i]].get("max_score", 39)
            next_min = thresholds[ordered[i + 1]]["min_score"]
            assert next_min == current_max + 1, f"Gap between {ordered[i]} and {ordered[i+1]}"


class TestComplianceScoreComputation:
    """Tests compliance score computation rules across marketplace modes."""

    def test_wb_only_upload_scenario_has_wb_rules(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        assert scenario["expected_analysis"]["marketplace_rules"] == "wb"
        assert scenario["expected_analysis"]["can_approve"] is True
        assert scenario["expected_analysis"]["quality_score"] == 95

    def test_combined_upload_scenario_has_strictest_rules(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_ozon"]
        assert scenario["expected_analysis"]["marketplace_rules"] == "wb+ozon_strictest"
        assert scenario["expected_analysis"]["can_approve"] is True
        assert scenario["expected_analysis"]["quality_score"] == 92
        assert scenario["strictest_rules"] is True

    def test_wb_only_marketplace_is_single_element(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        assert scenario["marketplaces"] == ["wildberries"]

    def test_combined_marketplace_has_both(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_ozon"]
        assert set(scenario["marketplaces"]) == {"wildberries", "ozon"}

    def test_main_plus_brief_scenario_wb_only(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["main_plus_brief"]
        assert scenario["marketplaces"] == ["wildberries"]
        assert scenario["expected_analysis"]["quality_score"] == 87
        assert scenario["expected_analysis"]["can_approve"] is True


class TestScoreImpactOnApproval:
    """Tests how compliance scores map to approval decisions."""

    @pytest.mark.parametrize("score,expected_severity,can_approve", [
        (95, "pass", True),
        (90, "pass", True),
        (85, "pass", True),
        (75, "pass", True),
        (70, "warning", True),
        (60, "warning", True),
        (55, "warning", True),
        (40, "warning", True),
        (39, "critical", False),
        (20, "critical", False),
        (0, "critical", False),
    ])
    def test_score_to_severity_and_approval_mapping(self, score, expected_severity, can_approve, fixture_data):
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        severity = None
        for level in ["excellent", "good", "acceptable", "poor", "critical"]:
            t = thresholds[level]
            min_s = t.get("min_score", 0)
            max_s = t.get("max_score", 100)
            if min_s <= score <= max_s:
                severity = t["severity"]
                break
        assert severity == expected_severity, f"Score {score} expected {expected_severity}, got {severity}"
        assert can_approve == (severity != "critical")

    def test_excellent_scores_allow_approval(self, fixture_data):
        for score in [90, 95, 100]:
            assert score >= fixture_data["ingestion_fixtures"]["quality_thresholds"]["excellent"]["min_score"]

    def test_critical_scores_block_approval(self, fixture_data):
        critical_max = fixture_data["ingestion_fixtures"]["quality_thresholds"]["critical"]["max_score"]
        assert critical_max < 40

    def test_warning_scores_allow_approval_but_flag(self, fixture_data):
        thresholds = fixture_data["ingestion_fixtures"]["quality_thresholds"]
        for level in ["acceptable", "poor"]:
            assert thresholds[level]["severity"] == "warning"
            assert thresholds[level]["min_score"] >= 40


class TestBlockingVsWarningCases:
    """Validate blocking vs warning case fixtures."""

    def test_critical_resolution_blocks(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "critical_resolution_blocks")
        assert case["severity"] == "critical"
        assert case["can_approve"] is False
        assert case["should_block_pipeline"] is True
        assert case["expected_error_code"] == "LOW_RESOLUTION"

    def test_warning_non_square_allows(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "warning_non_square_allows")
        assert case["severity"] == "warning"
        assert case["can_approve"] is True
        assert case["should_block_pipeline"] is False
        assert case["expected_warning_code"] == "NON_SQUARE_ASPECT"

    def test_critical_corrupt_blocks(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "critical_corrupt_blocks")
        assert case["severity"] == "critical"
        assert case["can_approve"] is False
        assert case["should_block_pipeline"] is True

    def test_warning_transparency_allows(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "warning_transparency_allows")
        assert case["severity"] == "warning"
        assert case["can_approve"] is True
        assert case["should_block_pipeline"] is False

    def test_critical_wrong_type_blocks(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "critical_wrong_type_blocks")
        assert case["severity"] == "critical"
        assert case["can_approve"] is False
        assert case["should_block_pipeline"] is True

    def test_warning_empty_brief_allows(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "warning_empty_brief_allows")
        assert case["severity"] == "warning"
        assert case["can_approve"] is True
        assert case["should_block_pipeline"] is False

    def test_critical_missing_main_blocks(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "critical_missing_main_blocks")
        assert case["severity"] == "critical"
        assert case["can_approve"] is False
        assert case["should_block_pipeline"] is True

    def test_critical_too_large_blocks(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "critical_too_large_blocks")
        assert case["severity"] == "critical"
        assert case["can_approve"] is False
        assert case["should_block_pipeline"] is True

    def test_critical_too_many_refs_blocks(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "critical_too_many_refs_blocks")
        assert case["severity"] == "critical"
        assert case["can_approve"] is False
        assert case["should_block_pipeline"] is True

    def test_warning_low_quality_score_allows(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["blocking_vs_warning_cases"]
        case = next(c for c in cases if c["id"] == "warning_low_quality_score_allows")
        assert case["severity"] == "warning"
        assert case["can_approve"] is True
        assert case["should_block_pipeline"] is False
        assert case["expected_quality_score"] == 65


class TestScoreConsistencyAcrossMarketplaceModes:
    """Verify score computation is consistent across WB-only, Ozon-only, combined."""

    def test_wb_only_scenario_score_above_excellent(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        score = scenario["expected_analysis"]["quality_score"]
        excellent_min = fixture_data["ingestion_fixtures"]["quality_thresholds"]["excellent"]["min_score"]
        assert score >= excellent_min

    def test_combined_scenario_score_above_excellent(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_ozon"]
        score = scenario["expected_analysis"]["quality_score"]
        excellent_min = fixture_data["ingestion_fixtures"]["quality_thresholds"]["excellent"]["min_score"]
        assert score >= excellent_min

    def test_combined_score_lower_or_equal_to_wb_only_with_same_input(self, fixture_data):
        wb_score = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]["expected_analysis"]["quality_score"]
        combined_score = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_ozon"]["expected_analysis"]["quality_score"]
        assert combined_score <= wb_score
