"""
Validation report content tests — fixture-based (no API needed).

Covers:
- Report structure and required fields
- Per-marketplace validation sections
- Failure and warning details
- Report consistency across WB-only, Ozon-only, and combined modes
"""
import pytest


class TestValidationReportStructure:
    """Tests that validation report schema has all required fields."""

    def test_report_has_project_id(self, fixture_data):
        schema = fixture_data["ingestion_fixtures"]["analysis_result_schema"]
        assert "project_id" in schema

    def test_report_has_uploaded_at(self, fixture_data):
        schema = fixture_data["ingestion_fixtures"]["analysis_result_schema"]
        assert "uploaded_at" in schema
        assert schema["uploaded_at"] == "iso8601"

    def test_report_has_marketplaces(self, fixture_data):
        schema = fixture_data["ingestion_fixtures"]["analysis_result_schema"]
        assert "marketplaces" in schema

    def test_report_has_main_image_section(self, fixture_data):
        schema = fixture_data["ingestion_fixtures"]["analysis_result_schema"]
        main = schema["main_image"]
        assert "filename" in main
        assert "content_type" in main
        assert "size_bytes" in main
        assert "dimensions" in main
        assert "content_hash" in main
        assert "quality_score" in main

    def test_report_has_additional_images(self, fixture_data):
        schema = fixture_data["ingestion_fixtures"]["analysis_result_schema"]
        assert "additional_images" in schema
        assert isinstance(schema["additional_images"], list)

    def test_report_has_reference_images(self, fixture_data):
        schema = fixture_data["ingestion_fixtures"]["analysis_result_schema"]
        assert "reference_images" in schema
        assert isinstance(schema["reference_images"], list)

    def test_report_has_brief_section(self, fixture_data):
        schema = fixture_data["ingestion_fixtures"]["analysis_result_schema"]
        brief = schema["brief"]
        assert "text" in brief
        assert "char_count" in brief

    def test_report_has_analysis_section(self, fixture_data):
        schema = fixture_data["ingestion_fixtures"]["analysis_result_schema"]
        assert "analysis" in schema

    def test_analysis_has_overall_quality_score(self, fixture_data):
        analysis = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["analysis"]
        assert "overall_quality_score" in analysis

    def test_analysis_has_can_approve(self, fixture_data):
        analysis = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["analysis"]
        assert "can_approve" in analysis

    def test_analysis_has_blocking_reasons(self, fixture_data):
        analysis = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["analysis"]
        assert "blocking_reasons" in analysis

    def test_analysis_has_warnings(self, fixture_data):
        analysis = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["analysis"]
        assert "warnings" in analysis

    def test_analysis_has_quality_flags_with_required_subfields(self, fixture_data):
        analysis = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["analysis"]
        flags = analysis["quality_flags"]
        assert isinstance(flags, list)
        flag_schema = flags[0]
        assert "code" in flag_schema
        assert "severity" in flag_schema
        assert "message" in flag_schema

    def test_quality_flag_severity_values(self, fixture_data):
        flag_schema = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["analysis"]["quality_flags"][0]
        severity_type = flag_schema["severity"]
        assert "critical" in severity_type
        assert "warning" in severity_type
        assert "info" in severity_type


class TestPerMarketplaceValidationReport:
    """Tests per-marketplace validation report schema."""

    def test_report_has_wildberries_section(self, fixture_data):
        mp = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["marketplace_validation"]
        assert "wildberries" in mp

    def test_report_has_ozon_section(self, fixture_data):
        mp = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["marketplace_validation"]
        assert "ozon" in mp

    def test_wb_section_has_passes(self, fixture_data):
        wb = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["marketplace_validation"]["wildberries"]
        assert "passes" in wb

    def test_wb_section_has_failures(self, fixture_data):
        wb = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["marketplace_validation"]["wildberries"]
        assert "failures" in wb

    def test_wb_section_has_warnings(self, fixture_data):
        wb = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["marketplace_validation"]["wildberries"]
        assert "warnings" in wb

    def test_ozon_section_has_passes(self, fixture_data):
        ozon = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["marketplace_validation"]["ozon"]
        assert "passes" in ozon

    def test_ozon_section_has_failures(self, fixture_data):
        ozon = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["marketplace_validation"]["ozon"]
        assert "failures" in ozon

    def test_ozon_section_has_warnings(self, fixture_data):
        ozon = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["marketplace_validation"]["ozon"]
        assert "warnings" in ozon


class TestValidationReportFailureDetails:
    """Tests that failure detail fixtures specify required information."""

    def test_resolution_failure_has_min_dimensions(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["invalid_input_scenarios"]
        case = next(c for c in cases if c["id"] == "low_resolution")
        assert "min_wb" in case["expected"]
        assert "min_ozon" in case["expected"]
        assert case["expected"]["min_wb"]["width"] == 900
        assert case["expected"]["min_ozon"]["width"] == 1000

    def test_keyword_failure_has_error_code(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["invalid_input_scenarios"]
        case = next(c for c in cases if c["id"] == "invalid_file_type")
        assert case["expected"]["error_code"] == "INVALID_FILE_TYPE"

    def test_file_size_failure_has_max_size(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["invalid_input_scenarios"]
        case = next(c for c in cases if c["id"] == "file_too_large")
        assert case["expected"]["max_size_bytes"] == 10_485_760

    def test_brief_too_long_has_max_chars(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["invalid_input_scenarios"]
        case = next(c for c in cases if c["id"] == "brief_too_long")
        assert case["expected"]["max_chars"] == 5000

    def test_too_many_refs_has_max_and_provided(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["invalid_input_scenarios"]
        case = next(c for c in cases if c["id"] == "too_many_references")
        assert case["expected"]["max_references"] == 5
        assert case["expected"]["provided"] == 6

    def test_all_blocking_cases_have_error_code(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["invalid_input_scenarios"]
        for case in cases:
            if case["expected"]["severity"] == "critical":
                assert "error_code" in case["expected"], f"Missing error_code in {case['id']}"

    def test_all_warning_cases_have_warning_code(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["invalid_input_scenarios"]
        for case in cases:
            if case["expected"]["severity"] == "warning":
                assert "warning_code" in case["expected"], f"Missing warning_code in {case['id']}"

    def test_all_cases_have_can_approve(self, fixture_data):
        cases = fixture_data["ingestion_fixtures"]["invalid_input_scenarios"]
        for case in cases:
            assert "can_approve" in case["expected"], f"Missing can_approve in {case['id']}"


class TestValidationReportConsistency:
    """Tests report consistency across marketplace modes."""

    def test_wb_only_scenario_references_wb_rules(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_only"]
        assert scenario["expected_analysis"]["marketplace_rules"] == "wb"

    def test_combined_scenario_references_strictest_rules(self, fixture_data):
        scenario = fixture_data["ingestion_fixtures"]["upload_scenarios"]["full_upload_wb_ozon"]
        assert scenario["expected_analysis"]["marketplace_rules"] == "wb+ozon_strictest"

    def test_regression_scenarios_cover_all_three_modes(self, fixture_data):
        for scenario in fixture_data["ingestion_fixtures"]["regression_scenarios"]:
            assert "wb_only" in scenario, f"Missing wb_only in {scenario['id']}"
            assert "ozon_only" in scenario, f"Missing ozon_only in {scenario['id']}"
            assert "wb_ozon_combined" in scenario, f"Missing wb_ozon_combined in {scenario['id']}"

    def test_combined_has_more_or_equal_prohibited_keywords(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]
        wb_kw = set(rules["wildberries"]["prohibited_keywords"])
        ozon_kw = set(rules["ozon"]["prohibited_keywords"])
        combined_kw = set(rules["wb_ozon_strictest"]["prohibited_keywords"])
        assert combined_kw >= wb_kw
        assert combined_kw >= ozon_kw

    def test_combined_has_more_or_equal_mandatory_fields(self, fixture_data):
        rules = fixture_data["ingestion_fixtures"]["marketplace_rules"]
        wb_f = set(rules["wildberries"]["mandatory_fields"])
        ozon_f = set(rules["ozon"]["mandatory_fields"])
        combined_f = set(rules["wb_ozon_strictest"]["mandatory_fields"])
        assert combined_f >= wb_f
        assert combined_f >= ozon_f

    def test_report_schema_has_both_marketplace_sections(self, fixture_data):
        mp = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["marketplace_validation"]
        assert set(mp.keys()) == {"wildberries", "ozon"}

    def test_analysis_result_schema_has_all_required_analysis_fields(self, fixture_data):
        analysis = fixture_data["ingestion_fixtures"]["analysis_result_schema"]["analysis"]
        required = {"category", "attributes", "quality_flags", "overall_quality_score", "can_approve", "blocking_reasons", "warnings"}
        assert required.issubset(set(analysis.keys()))
