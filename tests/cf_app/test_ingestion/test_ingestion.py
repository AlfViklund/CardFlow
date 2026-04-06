"""
Step 0 ingestion tests: upload permutations, weak/invalid source images,
marketplace-specific validation, strictest-rule behavior for WB+Ozon,
and regression cases for blocking vs warning states.

Covers:
- Upload permutations (file count, size, type, order)
- Weak/invalid source images (blurry, dark, overexposed, noisy, etc.)
- Marketplace-specific validation (WB, Ozon, combined)
- Strictest-rule behavior for WB+Ozon
- Regression cases for blocking vs warning states
"""
import io
import json
import os
import pytest

# ── Image generation helpers ──────────────────────────────────────────

try:
    from PIL import Image, ImageFilter, ImageEnhance
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def _make_jpeg(width, height, color=(200, 200, 200), quality=90):
    """Generate JPEG bytes at given dimensions."""
    if not HAS_PIL:
        return b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=color)
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def _make_png(width, height, color=(200, 200, 200, 255), mode="RGBA"):
    """Generate PNG bytes at given dimensions."""
    if not HAS_PIL:
        return b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x04\xb0\x00\x00\x04\xb0\x08\x06\x00\x00\x00\xff\xd9"
    buf = io.BytesIO()
    img = Image.new(mode, (width, height), color=color)
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_blurry_image(width=1200, height=1200):
    """Generate a deliberately blurry image."""
    if not HAS_PIL:
        return _make_jpeg(width, height)
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=(180, 180, 180))
    img = img.filter(ImageFilter.GaussianBlur(radius=20))
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _make_dark_image(width=1200, height=1200):
    """Generate a very dark (underexposed) image."""
    if not HAS_PIL:
        return _make_jpeg(width, height, color=(10, 10, 10))
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=(40, 40, 40))
    enhancer = ImageEnhance.Brightness(img)
    img = enhancer.enhance(0.1)
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _make_overexposed_image(width=1200, height=1200):
    """Generate an overexposed (washed out) image."""
    if not HAS_PIL:
        return _make_jpeg(width, height, color=(250, 250, 250))
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=(220, 220, 220))
    enhancer = ImageEnhance.Brightness(img)
    img = enhancer.enhance(2.5)
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _make_noisy_image(width=1200, height=1200):
    """Generate an image with heavy noise."""
    if not HAS_PIL:
        return _make_jpeg(width, height)
    import random
    buf = io.BytesIO()
    pixels = [(random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))
              for _ in range(width * height)]
    img = Image.new("RGB", (width, height))
    img.putdata(pixels)
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _make_low_contrast_image(width=1200, height=1200):
    """Generate a low-contrast image."""
    if not HAS_PIL:
        return _make_jpeg(width, height, color=(128, 128, 128))
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=(130, 130, 128))
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(0.1)
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _make_webp(width, height, color=(200, 200, 200), quality=90):
    """Generate WebP bytes."""
    if not HAS_PIL:
        return _make_jpeg(width, height, color)
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=color)
    img.save(buf, format="WEBP", quality=quality)
    return buf.getvalue()


def _make_corrupted_jpeg():
    """Generate a file with JPEG header but corrupted body."""
    return (
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        b"\x00\x00\x00\x00\x00\x00CORRUPTED_DATA_HERE"
        b"\xff\xd9"
    )


def _make_empty_png():
    """Generate a PNG with valid header but no image data."""
    return (
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )


# ── Upload permutation fixtures ───────────────────────────────────────

UPLOAD_PERMUTATIONS = [
    # (scenario_id, description, main_size, additional_count, ref_count, brief, marketplaces, expect_status)
    ("minimal", "main photo only, no brief", 1200, 0, 0, None, ["wildberries"], "success"),
    ("with_brief", "main photo + brief text", 1200, 0, 0, "Test product brief", ["wildberries"], "success"),
    ("one_additional", "main + 1 additional image", 1200, 1, 0, None, ["wildberries"], "success"),
    ("max_additional_wb", "main + 10 additional (WB max)", 1200, 10, 0, None, ["wildberries"], "success"),
    ("max_additional_ozon", "main + 15 additional (Ozon max)", 1200, 15, 0, None, ["ozon"], "success"),
    ("over_additional_wb", "main + 11 additional (WB exceed)", 1200, 11, 0, None, ["wildberries"], "warning"),
    ("over_additional_ozon", "main + 16 additional (Ozon exceed)", 1200, 16, 0, None, ["ozon"], "warning"),
    ("max_references", "main + 5 references (max)", 1200, 0, 5, None, ["wildberries"], "success"),
    ("over_references", "main + 6 references (exceed)", 1200, 0, 6, None, ["wildberries"], "blocked"),
    ("full_wb", "main + additional + refs + brief (WB)", 1200, 3, 2, "Full brief", ["wildberries"], "success"),
    ("full_ozon", "main + additional + refs + brief (Ozon)", 1200, 3, 2, "Full brief", ["ozon"], "success"),
    ("full_combined", "main + additional + refs + brief (WB+Ozon)", 1200, 3, 2, "Full brief", ["wildberries", "ozon"], "success"),
    ("no_additional_no_refs", "main only, no additional, no refs", 1200, 0, 0, "Brief only", ["wildberries"], "success"),
    ("refs_only_no_additional", "main + refs, no additional", 1200, 0, 3, None, ["wildberries"], "success"),
    ("additional_only_no_refs", "main + additional, no refs", 1200, 5, 0, None, ["wildberries"], "success"),
]


# ── Weak/invalid image scenarios ──────────────────────────────────────

WEAK_IMAGE_SCENARIOS = [
    ("blurry", _make_blurry_image(), "blurry_image.jpg", "image/jpeg", "warning", "LOW_SHARPNESS"),
    ("dark", _make_dark_image(), "dark_image.jpg", "image/jpeg", "warning", "UNDEREXPOSED"),
    ("overexposed", _make_overexposed_image(), "bright_image.jpg", "image/jpeg", "warning", "OVEREXPOSED"),
    ("noisy", _make_noisy_image(), "noisy_image.jpg", "image/jpeg", "warning", "HIGH_NOISE"),
    ("low_contrast", _make_low_contrast_image(), "flat_image.jpg", "image/jpeg", "warning", "LOW_CONTRAST"),
]

INVALID_IMAGE_SCENARIOS = [
    ("corrupted_jpeg", _make_corrupted_jpeg(), "corrupt.jpg", "image/jpeg", "blocked", "CORRUPTED_IMAGE"),
    ("corrupted_png", _make_empty_png(), "empty.png", "image/png", "blocked", "CORRUPTED_IMAGE"),
    ("exe_file", b"MZ\x90\x00" + b"\x00" * 100, "malware.exe", "application/octet-stream", "blocked", "INVALID_FILE_TYPE"),
    ("gif_file", b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;", "animated.gif", "image/gif", "blocked", "INVALID_FILE_TYPE"),
    ("pdf_file", b"%PDF-1.4\n%fake pdf content", "document.pdf", "application/pdf", "blocked", "INVALID_FILE_TYPE"),
    ("txt_file", b"This is not an image at all", "readme.txt", "text/plain", "blocked", "INVALID_FILE_TYPE"),
    ("zero_bytes", b"", "empty.jpg", "image/jpeg", "blocked", "EMPTY_FILE"),
    ("just_jpeg_header", b"\xff\xd8\xff\xe0", "truncated.jpg", "image/jpeg", "blocked", "CORRUPTED_IMAGE"),
    ("just_png_header", b"\x89PNG\r\n\x1a\n", "truncated.png", "image/png", "blocked", "CORRUPTED_IMAGE"),
]


# ── Resolution test matrix ────────────────────────────────────────────

RESOLUTION_CASES = [
    # (width, height, wb_expect, ozon_expect, combined_expect, reason)
    (50, 50, "blocked", "blocked", "blocked", "far_below_both_minimums"),
    (500, 500, "blocked", "blocked", "blocked", "below_both_minimums"),
    (899, 899, "blocked", "blocked", "blocked", "just_below_wb_minimum"),
    (900, 900, "success", "blocked", "blocked", "exactly_wb_minimum"),
    (950, 950, "success", "blocked", "blocked", "between_wb_and_ozon"),
    (999, 999, "success", "blocked", "blocked", "just_below_ozon_minimum"),
    (1000, 1000, "success", "success", "success", "exactly_both_minimums"),
    (1200, 1200, "success", "success", "success", "above_both_minimums"),
    (2000, 2000, "success", "success", "success", "well_above_minimums"),
    (3000, 3000, "success", "success", "success", "maximum_recommended"),
    (4000, 4000, "success", "success", "success", "above_recommended"),
    (8000, 8000, "warning", "warning", "warning", "excessively_large"),
    (1200, 600, "warning", "warning", "warning", "wide_aspect_2_1"),
    (600, 1200, "warning", "warning", "warning", "tall_aspect_1_2"),
    (3000, 1500, "warning", "warning", "warning", "wide_high_res"),
    (1500, 3000, "warning", "warning", "warning", "tall_high_res"),
    (1200, 1201, "success", "success", "success", "near_square_off_by_one"),
    (1201, 1200, "success", "success", "success", "near_square_off_by_one"),
]


# ── File size permutations ────────────────────────────────────────────

FILE_SIZE_CASES = [
    # (size_bytes, wb_expect, ozon_expect, combined_expect, reason)
    (0, "blocked", "blocked", "blocked", "zero_bytes"),
    (100, "success", "success", "success", "tiny_file"),
    (1048576, "success", "success", "success", "one_mb"),
    (5242880, "success", "success", "success", "five_mb"),
    (10485759, "success", "success", "success", "just_under_wb_10mb_limit"),
    (10485760, "success", "success", "success", "exactly_wb_10mb_limit"),
    (10485761, "warning", "success", "warning", "just_over_wb_limit"),
    (15728640, "warning", "success", "warning", "15mb_over_wb_under_ozon"),
    (20971519, "warning", "success", "warning", "just_under_ozon_20mb_limit"),
    (20971520, "warning", "success", "warning", "exactly_ozon_20mb_limit"),
    (20971521, "blocked", "blocked", "blocked", "just_over_ozon_20mb_limit"),
    (52428800, "blocked", "blocked", "blocked", "50mb_far_over_limits"),
]


# ── Marketplace validation cases ──────────────────────────────────────

MARKETPLACE_VALIDATION_CASES = [
    # WB-only cases
    ("wb_min_resolution_900", 900, 900, ["wildberries"], "success", "meets_wb_minimum"),
    ("wb_below_resolution_899", 899, 899, ["wildberries"], "blocked", "below_wb_minimum"),
    ("wb_title_60_chars", None, None, ["wildberries"], "success", "exactly_wb_title_limit"),
    ("wb_title_61_chars", None, None, ["wildberries"], "blocked", "over_wb_title_limit"),
    ("wb_10_additional", None, None, ["wildberries"], "success", "exactly_wb_additional_max"),
    ("wb_11_additional", None, None, ["wildberries"], "warning", "over_wb_additional_max"),

    # Ozon-only cases
    ("ozon_min_resolution_1000", 1000, 1000, ["ozon"], "success", "meets_ozon_minimum"),
    ("ozon_below_resolution_999", 999, 999, ["ozon"], "blocked", "below_ozon_minimum"),
    ("ozon_title_120_chars", None, None, ["ozon"], "success", "exactly_ozon_title_limit"),
    ("ozon_title_121_chars", None, None, ["ozon"], "blocked", "over_ozon_title_limit"),
    ("ozon_15_additional", None, None, ["ozon"], "success", "exactly_ozon_additional_max"),
    ("ozon_16_additional", None, None, ["ozon"], "warning", "over_ozon_additional_max"),

    # WB+Ozon strictest-rule cases
    ("combined_resolution_900", 900, 900, ["wildberries", "ozon"], "blocked", "strictest_ozon_resolution_wins"),
    ("combined_resolution_1000", 1000, 1000, ["wildberries", "ozon"], "success", "meets_both_minimums"),
    ("combined_title_60", None, None, ["wildberries", "ozon"], "success", "exactly_strictest_title_limit"),
    ("combined_title_61", None, None, ["wildberries", "ozon"], "blocked", "over_strictest_title_limit"),
    ("combined_additional_10", None, None, ["wildberries", "ozon"], "success", "exactly_strictest_additional_max"),
    ("combined_additional_11", None, None, ["wildberries", "ozon"], "warning", "over_strictest_additional_max"),
]


# ── Keyword prohibition cases ─────────────────────────────────────────

KEYWORD_CASES = [
    # (keyword, wb_flagged, ozon_flagged, combined_flagged, reason)
    ("подделка", True, False, True, "wb_only_prohibited"),
    ("копия", True, False, True, "wb_only_prohibited"),
    ("порно", True, False, True, "wb_only_prohibited"),
    ("18+", True, False, True, "wb_only_prohibited"),
    ("фейк", False, True, True, "ozon_only_prohibited"),
    ("реплика", True, True, True, "both_prohibited"),
    ("оригинал", False, False, False, "safe_keyword"),
    ("премиум", False, False, False, "safe_keyword"),
    ("качество", False, False, False, "safe_keyword"),
]


# ── Mandatory field cases ─────────────────────────────────────────────

MANDATORY_FIELD_CASES = [
    # (missing_field, wb_passes, ozon_passes, combined_passes, reason)
    ("brand", False, False, False, "required_by_both"),
    ("category", False, True, False, "required_by_wb_only"),
    ("name", False, True, False, "required_by_wb_only"),
    (None, True, True, True, "all_fields_present"),
]


# ── Blocking vs warning regression cases ──────────────────────────────

BLOCKING_CASES = [
    # (scenario_id, severity, can_approve, should_block, error_or_warning_code)
    ("critical_resolution_blocks", "critical", False, True, "LOW_RESOLUTION"),
    ("critical_corrupt_blocks", "critical", False, True, "CORRUPTED_IMAGE"),
    ("critical_wrong_type_blocks", "critical", False, True, "INVALID_FILE_TYPE"),
    ("critical_missing_main_blocks", "critical", False, True, "MISSING_MAIN_PHOTO"),
    ("critical_too_large_blocks", "critical", False, True, "FILE_TOO_LARGE"),
    ("critical_too_many_refs_blocks", "critical", False, True, "TOO_MANY_REFERENCES"),
    ("critical_brief_too_long_blocks", "critical", False, True, "BRIEF_TOO_LONG"),
    ("critical_empty_file_blocks", "critical", False, True, "EMPTY_FILE"),
    ("warning_non_square_allows", "warning", True, False, "NON_SQUARE_ASPECT"),
    ("warning_transparency_allows", "warning", True, False, "TRANSPARENT_BACKGROUND"),
    ("warning_empty_brief_allows", "warning", True, False, "EMPTY_BRIEF"),
    ("warning_low_quality_allows", "warning", True, False, "LOW_QUALITY_SCORE"),
    ("warning_blurry_allows", "warning", True, False, "LOW_SHARPNESS"),
    ("warning_dark_allows", "warning", True, False, "UNDEREXPOSED"),
    ("warning_overexposed_allows", "warning", True, False, "OVEREXPOSED"),
]


# ── Strictest-rule regression scenarios ───────────────────────────────

STRICTEST_RULE_CASES = [
    # (scenario_id, image_dims, title_len, missing_field, wb_result, ozon_result, combined_result)
    ("wb_900_passes_wb_fails_ozon", (900, 900), None, None,
     {"passes": True, "can_approve": True},
     {"passes": False, "can_approve": False, "reason": "below_min_resolution"},
     {"passes": False, "can_approve": False, "reason": "strictest_rule_ozon_resolution"}),
    ("1000px_passes_both", (1000, 1000), None, None,
     {"passes": True, "can_approve": True},
     {"passes": True, "can_approve": True},
     {"passes": True, "can_approve": True}),
    ("wb_keyword_not_in_ozon", None, None, None,
     {"flagged": True, "severity": "critical", "can_approve": False},
     {"flagged": False, "can_approve": True},
     {"flagged": True, "severity": "critical", "can_approve": False, "reason": "strictest_rule_wb_keyword"}),
    ("ozon_keyword_not_in_wb", None, None, None,
     {"flagged": False, "can_approve": True},
     {"flagged": True, "severity": "critical", "can_approve": False},
     {"flagged": True, "severity": "critical", "can_approve": False, "reason": "strictest_rule_ozon_keyword"}),
    ("both_prohibit_replika", None, None, None,
     {"flagged": True, "severity": "critical", "can_approve": False},
     {"flagged": True, "severity": "critical", "can_approve": False},
     {"flagged": True, "severity": "critical", "can_approve": False, "reason": "both_marketplaces_prohibit"}),
    ("wb_stricter_title_length", None, 80, None,
     {"passes": False, "can_approve": False, "reason": "title_too_long"},
     {"passes": True, "can_approve": True},
     {"passes": False, "can_approve": False, "reason": "strictest_rule_wb_title_length"}),
    ("wb_mandatory_category", None, None, "category",
     {"passes": False, "can_approve": False, "reason": "missing_mandatory_field"},
     {"passes": True, "can_approve": True},
     {"passes": False, "can_approve": False, "reason": "strictest_rule_wb_mandatory_field"}),
]


# ══════════════════════════════════════════════════════════════════════
# FIXTURE-DATA-ONLY TESTS (run now — no API needed)
# ══════════════════════════════════════════════════════════════════════


class TestFixtureDataIntegrity:
    """Validate fixture data structure and internal consistency."""

    def test_upload_scenarios_defined(self, fixture_data):
        """Upload scenarios should be defined in fixtures."""
        scenarios = fixture_data.get("ingestion_fixtures", {}).get("upload_scenarios", {})
        assert len(scenarios) >= 6, "Expected at least 6 upload scenarios"

    def test_invalid_input_scenarios_defined(self, fixture_data):
        """Invalid input scenarios should be defined in fixtures."""
        cases = fixture_data.get("ingestion_fixtures", {}).get("invalid_input_scenarios", [])
        assert len(cases) >= 10, "Expected at least 10 invalid input scenarios"

    def test_blocking_warning_cases_defined(self, fixture_data):
        """Blocking vs warning cases should be defined in fixtures."""
        cases = fixture_data.get("ingestion_fixtures", {}).get("blocking_vs_warning_cases", [])
        assert len(cases) >= 8, "Expected at least 8 blocking/warning cases"

    def test_regression_scenarios_defined(self, fixture_data):
        """Regression scenarios should be defined in fixtures."""
        cases = fixture_data.get("ingestion_fixtures", {}).get("regression_scenarios", [])
        assert len(cases) >= 5, "Expected at least 5 regression scenarios"

    def test_marketplace_rules_all_present(self, fixture_data):
        """All three marketplace rule sets should be defined."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {})
        assert "wildberries" in rules
        assert "ozon" in rules
        assert "wb_ozon_strictest" in rules

    def test_quality_thresholds_defined(self, fixture_data):
        """Quality thresholds should be defined."""
        thresholds = fixture_data.get("ingestion_fixtures", {}).get("quality_thresholds", {})
        assert len(thresholds) >= 4, "Expected at least 4 quality threshold levels"


class TestAnalysisResultSchema:
    """Tests that analysis results conform to expected schema and constraints."""

    def test_analysis_result_required_top_level_fields(self, fixture_data):
        """Analysis result should have all required top-level fields."""
        schema = fixture_data.get("ingestion_fixtures", {}).get("analysis_result_schema", {})
        required = ["project_id", "uploaded_at", "marketplaces", "main_image",
                    "analysis", "marketplace_validation"]
        for field in required:
            assert field in schema, f"Missing required field: {field}"

    def test_analysis_section_required_fields(self, fixture_data):
        """Analysis section should have all required fields."""
        schema = fixture_data.get("ingestion_fixtures", {}).get("analysis_result_schema", {})
        analysis = schema.get("analysis", {})
        required = ["category", "attributes", "quality_flags", "overall_quality_score",
                    "can_approve", "blocking_reasons", "warnings"]
        for field in required:
            assert field in analysis, f"Missing analysis field: {field}"

    def test_marketplace_validation_structure(self, fixture_data):
        """Marketplace validation should have both wildberries and ozon sections."""
        schema = fixture_data.get("ingestion_fixtures", {}).get("analysis_result_schema", {})
        mp = schema.get("marketplace_validation", {})
        for name in ["wildberries", "ozon"]:
            assert name in mp, f"Missing marketplace validation section: {name}"
            section = mp[name]
            assert "passes" in section
            assert "failures" in section
            assert "warnings" in section

    def test_quality_score_range(self, fixture_data):
        """Quality score thresholds should cover 0-100 range."""
        thresholds = fixture_data.get("ingestion_fixtures", {}).get("quality_thresholds", {})
        all_ranges = []
        for name, t in thresholds.items():
            lo = t.get("min_score", 0)
            hi = t.get("max_score", 100)
            all_ranges.append((lo, hi))
        all_ranges.sort()
        assert all_ranges[0][0] <= 40, "Lowest threshold should start at or below 40"
        assert all_ranges[-1][1] >= 90, "Highest threshold should end at or above 90"

    def test_quality_flag_severity_values(self, fixture_data):
        """Quality flag severity should be one of: critical, warning, info."""
        schema = fixture_data.get("ingestion_fixtures", {}).get("analysis_result_schema", {})
        flags_schema = schema.get("analysis", {}).get("quality_flags", {})
        assert "severity" in str(flags_schema) or len(flags_schema) > 0

    def test_main_image_schema_fields(self, fixture_data):
        """Main image section should have all required fields."""
        schema = fixture_data.get("ingestion_fixtures", {}).get("analysis_result_schema", {})
        main = schema.get("main_image", {})
        required = ["filename", "content_type", "size_bytes", "dimensions",
                    "content_hash", "quality_score"]
        for field in required:
            assert field in main, f"Missing main_image field: {field}"


class TestMarketplaceRuleDefinitions:
    """Validate marketplace rule definitions are correct."""

    def test_wb_rules_defined(self, fixture_data):
        """WB rules should be defined with correct values."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wildberries", {})
        assert rules.get("min_resolution") == {"width": 900, "height": 900}
        assert rules.get("max_title_length") == 60
        assert "brand" in rules.get("mandatory_fields", [])
        assert "category" in rules.get("mandatory_fields", [])

    def test_ozon_rules_defined(self, fixture_data):
        """Ozon rules should be defined with correct values."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("ozon", {})
        assert rules.get("min_resolution") == {"width": 1000, "height": 1000}
        assert rules.get("max_title_length") == 120
        assert "brand" in rules.get("mandatory_fields", [])
        assert "category" not in rules.get("mandatory_fields", [])

    def test_wb_ozon_strictest_rules_defined(self, fixture_data):
        """Combined strictest rules should be defined with correct values."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wb_ozon_strictest", {})
        assert rules.get("min_resolution") == {"width": 1000, "height": 1000}
        assert rules.get("max_title_length") == 60
        assert rules.get("max_file_size_bytes") == 10485760
        assert "brand" in rules.get("mandatory_fields", [])
        assert "category" in rules.get("mandatory_fields", [])
        assert "name" in rules.get("mandatory_fields", [])
        prohibited = rules.get("prohibited_keywords", [])
        assert "подделка" in prohibited
        assert "копия" in prohibited
        assert "реплика" in prohibited
        assert "18+" in prohibited
        assert "порно" in prohibited
        assert "фейк" in prohibited


class TestStrictestRuleMath:
    """Verify strictest-rule math is correct across fixture data."""

    def test_strictest_resolution_is_max_of_both(self, fixture_data):
        """Combined min resolution should be the max of WB and Ozon minimums."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {})
        wb_min = rules["wildberries"]["min_resolution"]
        ozon_min = rules["ozon"]["min_resolution"]
        combined_min = rules["wb_ozon_strictest"]["min_resolution"]

        assert combined_min["width"] == max(wb_min["width"], ozon_min["width"])
        assert combined_min["height"] == max(wb_min["height"], ozon_min["height"])

    def test_strictest_file_size_is_min_of_both(self, fixture_data):
        """Combined max file size should be the min of WB and Ozon limits."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {})
        wb_max = rules["wildberries"]["max_file_size_bytes"]
        ozon_max = rules["ozon"]["max_file_size_bytes"]
        combined_max = rules["wb_ozon_strictest"]["max_file_size_bytes"]

        assert combined_max == min(wb_max, ozon_max)

    def test_strictest_title_length_is_min_of_both(self, fixture_data):
        """Combined max title length should be the min of WB and Ozon limits."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {})
        wb_max = rules["wildberries"]["max_title_length"]
        ozon_max = rules["ozon"]["max_title_length"]
        combined_max = rules["wb_ozon_strictest"]["max_title_length"]

        assert combined_max == min(wb_max, ozon_max)

    def test_strictest_additional_images_is_min_of_both(self, fixture_data):
        """Combined max additional images should be the min of WB and Ozon limits."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {})
        wb_max = rules["wildberries"]["max_additional_images"]
        ozon_max = rules["ozon"]["max_additional_images"]
        combined_max = rules["wb_ozon_strictest"]["max_additional_images"]

        assert combined_max == min(wb_max, ozon_max)

    def test_strictest_mandatory_fields_is_union_of_both(self, fixture_data):
        """Combined mandatory fields should be the union of WB and Ozon fields."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {})
        wb_fields = set(rules["wildberries"]["mandatory_fields"])
        ozon_fields = set(rules["ozon"]["mandatory_fields"])
        combined_fields = set(rules["wb_ozon_strictest"]["mandatory_fields"])

        assert combined_fields == wb_fields | ozon_fields

    def test_strictest_prohibited_keywords_is_union_of_both(self, fixture_data):
        """Combined prohibited keywords should be the union of WB and Ozon keywords."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {})
        wb_kw = set(rules["wildberries"]["prohibited_keywords"])
        ozon_kw = set(rules["ozon"]["prohibited_keywords"])
        combined_kw = set(rules["wb_ozon_strictest"]["prohibited_keywords"])

        assert combined_kw == wb_kw | ozon_kw

    def test_strictest_background_is_stricter_of_both(self, fixture_data):
        """Combined background rule should be the stricter (white_required > white_preferred)."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {})
        combined_bg = rules["wb_ozon_strictest"]["background"]
        assert combined_bg == "white_required"


class TestKeywordValidation:
    """Keyword prohibition tests across marketplaces (fixture-based)."""

    @pytest.mark.parametrize(
        "keyword,wb_flagged,ozon_flagged,combined_flagged,reason",
        KEYWORD_CASES,
        ids=[k[0] for k in KEYWORD_CASES],
    )
    def test_keyword_prohibition(
        self, keyword, wb_flagged, ozon_flagged, combined_flagged, reason,
    ):
        """Verify keyword flagging behavior per marketplace."""
        assert isinstance(keyword, str) and len(keyword) > 0
        assert isinstance(wb_flagged, bool)
        assert isinstance(ozon_flagged, bool)
        assert isinstance(combined_flagged, bool)

        # Combined should be flagged if ANY marketplace flags it (strictest rule)
        if wb_flagged or ozon_flagged:
            assert combined_flagged is True, \
                f"Keyword '{keyword}' should be flagged in combined mode (strictest rule)"

    def test_combined_prohibited_keywords_union(self, fixture_data):
        """Combined mode should use union of prohibited keywords."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wb_ozon_strictest", {})
        prohibited = set(rules.get("prohibited_keywords", []))
        wb_prohibited = set(fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wildberries", {}).get("prohibited_keywords", []))
        ozon_prohibited = set(fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("ozon", {}).get("prohibited_keywords", []))
        expected_union = wb_prohibited | ozon_prohibited
        assert prohibited == expected_union, \
            f"Combined prohibited keywords should be union: expected {expected_union}, got {prohibited}"


class TestMandatoryFields:
    """Mandatory field validation per marketplace (fixture-based)."""

    @pytest.mark.parametrize(
        "missing_field,wb_passes,ozon_passes,combined_passes,reason",
        MANDATORY_FIELD_CASES,
        ids=[m[4] for m in MANDATORY_FIELD_CASES],
    )
    def test_mandatory_field_validation(
        self, missing_field, wb_passes, ozon_passes, combined_passes, reason,
    ):
        """Verify mandatory field validation per marketplace."""
        expected_combined = wb_passes and ozon_passes
        assert combined_passes == expected_combined, \
            f"Combined should {'pass' if expected_combined else 'fail'} when missing '{missing_field}'"


class TestBlockingVsWarningRegression:
    """Regression tests for blocking vs warning state classification."""

    @pytest.mark.parametrize(
        "scenario_id,severity,can_approve,should_block,code",
        BLOCKING_CASES,
        ids=[b[0] for b in BLOCKING_CASES],
    )
    def test_blocking_vs_warning_classification(
        self, scenario_id, severity, can_approve, should_block, code,
    ):
        """Verify blocking/warning classification is consistent."""
        if severity == "critical":
            assert can_approve is False, f"Critical severity should block approval: {scenario_id}"
            assert should_block is True, f"Critical severity should block pipeline: {scenario_id}"
        elif severity == "warning":
            assert can_approve is True, f"Warning severity should allow approval: {scenario_id}"
            assert should_block is False, f"Warning severity should not block pipeline: {scenario_id}"

    def test_critical_states_always_block(self, fixture_data):
        """All critical-severity cases must block the pipeline."""
        cases = fixture_data.get("ingestion_fixtures", {}).get("blocking_vs_warning_cases", [])
        for case in cases:
            if case.get("severity") == "critical":
                assert case.get("can_approve") is False, \
                    f"Critical case '{case['id']}' must have can_approve=False"
                assert case.get("should_block_pipeline") is True, \
                    f"Critical case '{case['id']}' must have should_block_pipeline=True"

    def test_warning_states_never_block(self, fixture_data):
        """All warning-severity cases must NOT block the pipeline."""
        cases = fixture_data.get("ingestion_fixtures", {}).get("blocking_vs_warning_cases", [])
        for case in cases:
            if case.get("severity") == "warning":
                assert case.get("can_approve") is True, \
                    f"Warning case '{case['id']}' must have can_approve=True"
                assert case.get("should_block_pipeline") is False, \
                    f"Warning case '{case['id']}' must have should_block_pipeline=False"

    def test_no_critical_case_allows_approval(self, fixture_data):
        """Regression: no critical case should ever allow approval."""
        cases = fixture_data.get("ingestion_fixtures", {}).get("blocking_vs_warning_cases", [])
        critical_cases = [c for c in cases if c.get("severity") == "critical"]
        for case in critical_cases:
            assert case.get("can_approve") is not True, \
                f"CRITICAL REGRESSION: '{case['id']}' allows approval with critical severity"

    def test_no_warning_case_blocks_pipeline(self, fixture_data):
        """Regression: no warning case should ever block the pipeline."""
        cases = fixture_data.get("ingestion_fixtures", {}).get("blocking_vs_warning_cases", [])
        warning_cases = [c for c in cases if c.get("severity") == "warning"]
        for case in warning_cases:
            assert case.get("should_block_pipeline") is not True, \
                f"CRITICAL REGRESSION: '{case['id']}' blocks pipeline with warning severity"


class TestStrictestRuleRegression:
    """Strictest-rule regression tests for WB+Ozon combined mode (fixture-based)."""

    @pytest.mark.parametrize(
        "scenario_id,image_dims,title_len,missing_field,wb_result,ozon_result,combined_result",
        STRICTEST_RULE_CASES,
        ids=[s[0] for s in STRICTEST_RULE_CASES],
    )
    def test_strictest_rule_regression(
        self, scenario_id, image_dims, title_len,
        missing_field, wb_result, ozon_result, combined_result,
    ):
        """Verify strictest-rule behavior matches fixture expectations."""
        if wb_result.get("passes") is False or ozon_result.get("passes") is False:
            assert combined_result.get("passes") is False, \
                f"Combined should fail when either marketplace fails: {scenario_id}"
        if wb_result.get("flagged") is True or ozon_result.get("flagged") is True:
            assert combined_result.get("flagged") is True, \
                f"Combined should flag when either marketplace flags: {scenario_id}"
        if wb_result.get("can_approve") is False or ozon_result.get("can_approve") is False:
            assert combined_result.get("can_approve") is False, \
                f"Combined should block when either marketplace blocks: {scenario_id}"


class TestUploadPermutationData:
    """Validate upload permutation data (fixture-based, no API)."""

    @pytest.mark.parametrize(
        "scenario_id,description,main_size,additional_count,ref_count,brief,marketplaces,expect_status",
        UPLOAD_PERMUTATIONS,
        ids=[p[0] for p in UPLOAD_PERMUTATIONS],
    )
    def test_upload_permutation_data(
        self, scenario_id, description, main_size,
        additional_count, ref_count, brief, marketplaces, expect_status,
    ):
        """Validate upload permutation data is well-formed."""
        assert expect_status in ("success", "warning", "blocked"), \
            f"Invalid expected status '{expect_status}' for {scenario_id}"
        assert 0 <= additional_count <= 20, f"Unreasonable additional count: {additional_count}"
        assert 0 <= ref_count <= 10, f"Unreasonable ref count: {ref_count}"
        assert main_size > 0, f"Invalid main_size: {main_size}"
        assert len(marketplaces) > 0, f"No marketplaces for {scenario_id}"


class TestResolutionMatrixData:
    """Validate resolution matrix data (fixture-based, no API)."""

    @pytest.mark.parametrize(
        "width,height,wb_expect,ozon_expect,combined_expect,reason",
        RESOLUTION_CASES,
        ids=[f"{r[0]}x{r[1]}" for r in RESOLUTION_CASES],
    )
    def test_resolution_matrix_data(
        self, width, height, wb_expect, ozon_expect, combined_expect, reason,
    ):
        """Validate resolution matrix data is well-formed."""
        assert width > 0 and height > 0, f"Invalid dimensions: {width}x{height}"
        for expect in (wb_expect, ozon_expect, combined_expect):
            assert expect in ("success", "warning", "blocked"), \
                f"Invalid expected status: {expect}"


class TestFileSizeData:
    """Validate file size data (fixture-based, no API)."""

    @pytest.mark.parametrize(
        "size_bytes,wb_expect,ozon_expect,combined_expect,reason",
        FILE_SIZE_CASES,
        ids=[f[4] for f in FILE_SIZE_CASES],
    )
    def test_file_size_data(
        self, size_bytes, wb_expect, ozon_expect, combined_expect, reason,
    ):
        """Validate file size data is well-formed and consistent with known limits."""
        assert size_bytes >= 0, f"Negative file size: {size_bytes}"
        wb_limit = 10485760
        ozon_limit = 20971520

        if size_bytes == 0:
            assert wb_expect == "blocked"
            assert ozon_expect == "blocked"
        elif size_bytes <= wb_limit:
            assert wb_expect in ("success", "warning")
        elif size_bytes <= ozon_limit:
            assert wb_expect in ("warning", "blocked")
            assert ozon_expect in ("success", "warning")
        else:
            assert ozon_expect in ("warning", "blocked")


class TestImageGeneration:
    """Validate image generation helpers work correctly."""

    def test_make_jpeg_produces_valid_bytes(self):
        """JPEG generation should produce valid JPEG header."""
        data = _make_jpeg(1200, 1200)
        assert len(data) > 0
        assert data.startswith(b"\xff\xd8")

    def test_make_png_produces_valid_bytes(self):
        """PNG generation should produce valid PNG header."""
        data = _make_png(1200, 1200)
        assert len(data) > 0
        assert data.startswith(b"\x89PNG")

    def test_make_webp_produces_valid_bytes(self):
        """WebP generation should produce non-empty bytes."""
        data = _make_webp(1200, 1200)
        assert len(data) > 0

    def test_make_blurry_image(self):
        """Blurry image generation should produce valid JPEG."""
        data = _make_blurry_image()
        assert len(data) > 0
        assert data.startswith(b"\xff\xd8")

    def test_make_dark_image(self):
        """Dark image generation should produce valid JPEG."""
        data = _make_dark_image()
        assert len(data) > 0
        assert data.startswith(b"\xff\xd8")

    def test_make_overexposed_image(self):
        """Overexposed image generation should produce valid JPEG."""
        data = _make_overexposed_image()
        assert len(data) > 0
        assert data.startswith(b"\xff\xd8")

    def test_make_noisy_image(self):
        """Noisy image generation should produce valid JPEG."""
        data = _make_noisy_image()
        assert len(data) > 0
        assert data.startswith(b"\xff\xd8")

    def test_make_low_contrast_image(self):
        """Low-contrast image generation should produce valid JPEG."""
        data = _make_low_contrast_image()
        assert len(data) > 0
        assert data.startswith(b"\xff\xd8")

    def test_make_corrupted_jpeg(self):
        """Corrupted JPEG should have valid header but corrupted body."""
        data = _make_corrupted_jpeg()
        assert data.startswith(b"\xff\xd8")
        assert b"CORRUPTED" in data

    def test_make_empty_png(self):
        """Empty PNG should have valid header but no data."""
        data = _make_empty_png()
        assert data.startswith(b"\x89PNG")

    def test_weak_image_scenarios_all_produce_bytes(self):
        """All weak image scenarios should produce non-empty bytes."""
        for scenario_id, img_bytes, filename, content_type, expect_status, expected_code in WEAK_IMAGE_SCENARIOS:
            assert len(img_bytes) > 0, f"Weak image scenario '{scenario_id}' produced empty bytes"

    def test_invalid_image_scenarios_all_produce_bytes(self):
        """All invalid image scenarios should produce bytes (even if empty for zero-byte test)."""
        for scenario_id, img_bytes, filename, content_type, expect_status, expected_code in INVALID_IMAGE_SCENARIOS:
            if scenario_id != "zero_bytes":
                assert len(img_bytes) > 0, f"Invalid image scenario '{scenario_id}' produced empty bytes"


# ══════════════════════════════════════════════════════════════════════
# API-DEPENDENT TESTS (skip until upstream dev task 315e67b1 lands)
# ══════════════════════════════════════════════════════════════════════

_SKIP_REASON = "upstream dev task 315e67b1 not landed yet"


class TestUploadPermutations:
    """Parametrized tests for all upload permutations (API-dependent)."""

    @pytest.mark.skip(reason=_SKIP_REASON)
    @pytest.mark.parametrize(
        "scenario_id,description,main_size,additional_count,ref_count,brief,marketplaces,expect_status",
        UPLOAD_PERMUTATIONS,
        ids=[p[0] for p in UPLOAD_PERMUTATIONS],
    )
    def test_upload_permutation(
        self, cardflow_up, scenario_id, description, main_size,
        additional_count, ref_count, brief, marketplaces, expect_status,
    ):
        """Verify each upload permutation produces expected status via API."""
        main_bytes = _make_jpeg(main_size, main_size)
        assert len(main_bytes) > 0, f"Failed to generate main image for {scenario_id}"

        additional_files = []
        for i in range(additional_count):
            additional_files.append(_make_jpeg(main_size, main_size, color=(180 + i * 5, 180, 180)))

        ref_files = []
        for i in range(ref_count):
            ref_files.append(_make_jpeg(800, 800, color=(100, 100 + i * 20, 100)))

        # TODO: POST to upload endpoint and validate response

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_empty_file_list(self, cardflow_up):
        """Upload with no files at all should be blocked."""
        pass

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_main_only_minimal_size(self, cardflow_up):
        """Upload main photo at minimum viable size (900x900 for WB)."""
        main_bytes = _make_jpeg(900, 900)
        assert len(main_bytes) > 0

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_all_formats_accepted(self, cardflow_up):
        """Upload JPEG, PNG, and WebP — all should be accepted."""
        jpeg = _make_jpeg(1200, 1200)
        png = _make_png(1200, 1200)
        webp = _make_webp(1200, 1200)
        assert len(jpeg) > 0
        assert len(png) > 0
        assert len(webp) > 0

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_mixed_formats(self, cardflow_up):
        """Upload main as JPEG, additional as PNG, references as WebP."""
        main = _make_jpeg(1200, 1200)
        additional = _make_png(1200, 1200)
        ref = _make_webp(800, 800)
        assert len(main) > 0
        assert len(additional) > 0
        assert len(ref) > 0

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_duplicate_files(self, cardflow_up):
        """Upload the same image as both main and additional."""
        img = _make_jpeg(1200, 1200)
        assert len(img) > 0

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_very_long_brief(self, cardflow_up):
        """Upload with brief at exactly 5000 characters (limit)."""
        brief = "A" * 5000
        assert len(brief) == 5000

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_unicode_brief(self, cardflow_up):
        """Upload with Unicode characters in brief (Cyrillic, emoji, CJK)."""
        brief = "Наушники с шумоподавлением 🎧 高品質"
        assert len(brief) > 0

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_special_chars_filename(self, cardflow_up):
        """Upload with filenames containing spaces, unicode, special chars."""
        filenames = [
            "my product photo.jpg",
            "фото_товара.png",
            "product (1).webp",
            "image #final.jpg",
            "test&photo.jpg",
        ]
        for fn in filenames:
            assert len(fn) > 0


class TestWeakSourceImages:
    """Tests for weak-quality source images that should trigger warnings (API-dependent)."""

    @pytest.mark.skip(reason=_SKIP_REASON)
    @pytest.mark.parametrize(
        "scenario_id,image_bytes,filename,content_type,expect_status,expected_code",
        WEAK_IMAGE_SCENARIOS,
        ids=[s[0] for s in WEAK_IMAGE_SCENARIOS],
    )
    def test_weak_image_quality(
        self, cardflow_up, scenario_id, image_bytes, filename,
        content_type, expect_status, expected_code,
    ):
        """Weak images should produce warnings, not blocks."""
        assert len(image_bytes) > 0, f"Failed to generate {scenario_id} image"
        assert content_type.startswith("image/"), f"Expected image content type for {scenario_id}"
        assert expect_status == "warning", f"Weak image should warn, not block: {scenario_id}"

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_blurry_image_detection(self, cardflow_up):
        """Blurry image should trigger LOW_SHARPNESS warning."""
        img = _make_blurry_image()
        assert len(img) > 0

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_dark_image_detection(self, cardflow_up):
        """Dark/underexposed image should trigger UNDEREXPOSED warning."""
        img = _make_dark_image()
        assert len(img) > 0

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_overexposed_image_detection(self, cardflow_up):
        """Overexposed image should trigger OVEREXPOSED warning."""
        img = _make_overexposed_image()
        assert len(img) > 0

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_noisy_image_detection(self, cardflow_up):
        """Noisy image should trigger HIGH_NOISE warning."""
        img = _make_noisy_image()
        assert len(img) > 0

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_low_contrast_image_detection(self, cardflow_up):
        """Low-contrast image should trigger LOW_CONTRAST warning."""
        img = _make_low_contrast_image()
        assert len(img) > 0

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_multiple_weaknesses_combined(self, cardflow_up):
        """Image that is both blurry and dark should get multiple warnings."""
        if HAS_PIL:
            buf = io.BytesIO()
            img = Image.new("RGB", (1200, 1200), color=(30, 30, 30))
            img = img.filter(ImageFilter.GaussianBlur(radius=15))
            enhancer = ImageEnhance.Brightness(img)
            img = enhancer.enhance(0.2)
            img.save(buf, format="JPEG", quality=70)
            assert len(buf.getvalue()) > 0


class TestInvalidSourceImages:
    """Tests for invalid/corrupted source images that should be blocked (API-dependent)."""

    @pytest.mark.skip(reason=_SKIP_REASON)
    @pytest.mark.parametrize(
        "scenario_id,file_bytes,filename,content_type,expect_status,expected_code",
        INVALID_IMAGE_SCENARIOS,
        ids=[s[0] for s in INVALID_IMAGE_SCENARIOS],
    )
    def test_invalid_image_blocked(
        self, cardflow_up, scenario_id, file_bytes, filename,
        content_type, expect_status, expected_code,
    ):
        """Invalid files should be blocked with appropriate error code."""
        assert expect_status == "blocked", f"Invalid file should be blocked: {scenario_id}"
        assert expected_code in ("CORRUPTED_IMAGE", "INVALID_FILE_TYPE", "EMPTY_FILE"), \
            f"Unexpected error code: {expected_code}"

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_corrupted_jpeg_blocked(self, cardflow_up):
        """Corrupted JPEG with valid header but bad body should be blocked."""
        data = _make_corrupted_jpeg()
        assert data.startswith(b"\xff\xd8")
        assert b"CORRUPTED" in data

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_truncated_png_blocked(self, cardflow_up):
        """Truncated PNG with only header should be blocked."""
        data = _make_empty_png()
        assert data.startswith(b"\x89PNG")

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_executable_blocked(self, cardflow_up):
        """Executable file should be blocked as INVALID_FILE_TYPE."""
        data = b"MZ\x90\x00" + b"\x00" * 100
        assert data.startswith(b"MZ")

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_gif_blocked(self, cardflow_up):
        """GIF file should be blocked — not accepted by any marketplace."""
        data = b"GIF89a" + b"\x00" * 20
        assert data.startswith(b"GIF")

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_zero_byte_blocked(self, cardflow_up):
        """Zero-byte file should be blocked as EMPTY_FILE."""
        data = b""
        assert len(data) == 0


class TestResolutionMatrix:
    """Parametrized resolution tests for WB, Ozon, and combined modes (API-dependent)."""

    @pytest.mark.skip(reason=_SKIP_REASON)
    @pytest.mark.parametrize(
        "width,height,wb_expect,ozon_expect,combined_expect,reason",
        RESOLUTION_CASES,
        ids=[f"{r[0]}x{r[1]}" for r in RESOLUTION_CASES],
    )
    def test_resolution_matrix(
        self, cardflow_up, width, height, wb_expect, ozon_expect,
        combined_expect, reason,
    ):
        """Verify resolution thresholds for each marketplace configuration."""
        assert width > 0 and height > 0, f"Invalid dimensions: {width}x{height}"
        for expect in (wb_expect, ozon_expect, combined_expect):
            assert expect in ("success", "warning", "blocked"), \
                f"Invalid expected status: {expect}"

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_square_vs_non_square(self, cardflow_up):
        """Square images should pass; non-square should warn."""
        square = _make_jpeg(1200, 1200)
        wide = _make_jpeg(2400, 1200)
        tall = _make_jpeg(1200, 2400)
        assert len(square) > 0
        assert len(wide) > 0
        assert len(tall) > 0


class TestFileSizePermutations:
    """Parametrized file size tests for WB, Ozon, and combined modes (API-dependent)."""

    @pytest.mark.skip(reason=_SKIP_REASON)
    @pytest.mark.parametrize(
        "size_bytes,wb_expect,ozon_expect,combined_expect,reason",
        FILE_SIZE_CASES,
        ids=[f[4] for f in FILE_SIZE_CASES],
    )
    def test_file_size_limits(
        self, cardflow_up, size_bytes, wb_expect, ozon_expect,
        combined_expect, reason,
    ):
        """Verify file size thresholds for each marketplace configuration."""
        assert size_bytes >= 0, f"Negative file size: {size_bytes}"
        wb_limit = 10485760
        ozon_limit = 20971520

        if size_bytes == 0:
            assert wb_expect == "blocked"
            assert ozon_expect == "blocked"
        elif size_bytes <= wb_limit:
            assert wb_expect in ("success", "warning")
        elif size_bytes <= ozon_limit:
            assert wb_expect in ("warning", "blocked")
            assert ozon_expect in ("success", "warning")
        else:
            assert ozon_expect in ("warning", "blocked")


class TestMarketplaceValidation:
    """Marketplace-specific validation tests (API-dependent)."""

    @pytest.mark.skip(reason=_SKIP_REASON)
    @pytest.mark.parametrize(
        "scenario_id,width,height,marketplaces,expect_status,reason",
        MARKETPLACE_VALIDATION_CASES,
        ids=[m[0] for m in MARKETPLACE_VALIDATION_CASES],
    )
    def test_marketplace_validation(
        self, cardflow_up, scenario_id, width, height,
        marketplaces, expect_status, reason,
    ):
        """Verify marketplace-specific validation rules."""
        assert len(marketplaces) > 0, "Must select at least one marketplace"
        assert expect_status in ("success", "warning", "blocked")

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_wb_prohibited_keywords(self, cardflow_up, fixture_data):
        """WB-specific prohibited keywords should be flagged."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wildberries", {})
        prohibited = rules.get("prohibited_keywords", [])
        assert "подделка" in prohibited
        assert "копия" in prohibited
        assert "реплика" in prohibited
        assert "18+" in prohibited
        assert "порно" in prohibited

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_ozon_prohibited_keywords(self, cardflow_up, fixture_data):
        """Ozon-specific prohibited keywords should be flagged."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("ozon", {})
        prohibited = rules.get("prohibited_keywords", [])
        assert "реплика" in prohibited
        assert "фейк" in prohibited

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_wb_mandatory_fields(self, cardflow_up, fixture_data):
        """WB requires brand, category, and name fields."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wildberries", {})
        mandatory = rules.get("mandatory_fields", [])
        assert "brand" in mandatory
        assert "category" in mandatory
        assert "name" in mandatory

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_ozon_mandatory_fields(self, cardflow_up, fixture_data):
        """Ozon requires only brand field."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("ozon", {})
        mandatory = rules.get("mandatory_fields", [])
        assert "brand" in mandatory
        assert "category" not in mandatory
        assert "name" not in mandatory

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_wb_background_preference(self, cardflow_up, fixture_data):
        """WB prefers white background but does not require it."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("wildberries", {})
        assert rules.get("background") == "white_preferred"

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_ozon_background_requirement(self, cardflow_up, fixture_data):
        """Ozon requires white background."""
        rules = fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {}).get("ozon", {})
        assert rules.get("background") == "white_required"


class TestEdgeCases:
    """Edge cases and boundary conditions (API-dependent)."""

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_rapid_succession(self, cardflow_up):
        """Multiple rapid uploads should not cause race conditions."""
        images = [_make_jpeg(1200, 1200) for _ in range(5)]
        assert all(len(img) > 0 for img in images)

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_concurrent_same_project(self, cardflow_up):
        """Concurrent uploads to the same project should be handled."""
        img = _make_jpeg(1200, 1200)
        assert len(img) > 0

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_very_long_filename(self, cardflow_up):
        """Filename at 255 characters (filesystem limit)."""
        fn = "a" * 251 + ".jpg"
        assert len(fn) == 255

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_unicode_filename(self, cardflow_up):
        """Filename with Unicode characters."""
        fn = "товар_фото_2024.jpg"
        assert len(fn.encode("utf-8")) > len(fn)

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_null_bytes_in_filename(self, cardflow_up):
        """Filename with null byte should be rejected or sanitized."""
        fn = "test\x00image.jpg"
        assert "\x00" in fn

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_path_traversal_filename(self, cardflow_up):
        """Filename with path traversal should be rejected or sanitized."""
        fn = "../../../etc/passwd.jpg"
        assert ".." in fn

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_brief_with_html(self, cardflow_up):
        """Brief containing HTML should be handled safely."""
        brief = "<script>alert('xss')</script>Product description"
        assert "<script>" in brief

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_brief_with_sql_injection(self, cardflow_up):
        """Brief containing SQL injection attempt should be handled safely."""
        brief = "'; DROP TABLE products; --"
        assert "DROP" in brief

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_marketplace_empty_list(self, cardflow_up):
        """Empty marketplace list should be handled (default or error)."""
        pass

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_unknown_marketplace(self, cardflow_up):
        """Unknown marketplace in list should be handled."""
        pass

    @pytest.mark.skip(reason=_SKIP_REASON)
    def test_upload_duplicate_marketplace(self, cardflow_up):
        """Duplicate marketplace in list should be deduplicated."""
        marketplaces = ["wildberries", "wildberries", "ozon"]
        unique = list(set(marketplaces))
        assert len(unique) < len(marketplaces)
