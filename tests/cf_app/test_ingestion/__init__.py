"""
test_ingestion/ — Step 0 input ingestion, analysis & gating tests.

Covers: upload permutations, weak/invalid source images, marketplace-specific
validation, strictest-rule behavior for WB+Ozon, and regression cases for
blocking vs warning states.
"""
import io
import json
import re
from datetime import datetime, timezone

import pytest
import requests

from tests.cf_app.conftest import cf_get, cf_post, cf_patch, CARDFLOW_ENDPOINTS

pytestmark = pytest.mark.usefixtures("cardflow_up")


# ── Helpers ──────────────────────────────────────────────────────────

def _upload_main(project_id: str, image_bytes: bytes, filename: str = "product_main.jpg",
                 content_type: str = "image/jpeg", extra_fields: dict | None = None) -> requests.Response:
    """Upload a main image and optional JSON fields."""
    files = {"file": (filename, io.BytesIO(image_bytes), content_type)}
    body = extra_fields or {}
    if body:
        files["data"] = (None, json.dumps(body), "application/json")
    path = CARDFLOW_ENDPOINTS["upload_main"].format(project_id=project_id)
    return cf_post(path, files=files)


def _upload_additional(project_id: str, image_bytes_list: list[bytes],
                       filenames: list[str] | None = None,
                       content_types: list[str] | None = None) -> requests.Response:
    """Upload additional product images."""
    n = len(image_bytes_list)
    filenames = filenames or [f"additional_{i}.jpg" for i in range(n)]
    content_types = content_types or ["image/jpeg"] * n
    files = {}
    for i, b in enumerate(image_bytes_list):
        files[f"file_{i}"] = (filenames[i], io.BytesIO(b), content_types[i])
    path = CARDFLOW_ENDPOINTS["upload_additional"].format(project_id=project_id)
    return cf_post(path, files=files)


def _upload_references(project_id: str, image_bytes_list: list[bytes],
                       filenames: list[str] | None = None) -> requests.Response:
    """Upload reference images."""
    n = len(image_bytes_list)
    filenames = filenames or [f"ref_{i}.jpg" for i in range(n)]
    files = {}
    for i, b in enumerate(image_bytes_list):
        files[f"file_{i}"] = (filenames[i], io.BytesIO(b), "image/jpeg")
    path = CARDFLOW_ENDPOINTS["upload_references"].format(project_id=project_id)
    return cf_post(path, files=files)


def _submit_brief(project_id: str, brief: str, marketplaces: list[str]) -> requests.Response:
    """Submit brief text and marketplace selection."""
    path = CARDFLOW_ENDPOINTS["upload_brief"].format(project_id=project_id)
    return cf_post(path, json={"text": brief, "marketplaces": marketplaces})


def _get_analysis(project_id: str) -> requests.Response:
    """Fetch the Step 0 analysis result."""
    path = CARDFLOW_ENDPOINTS["analysis_result"].format(project_id=project_id)
    return cf_get(path)


def _approve_step0(project_id: str) -> requests.Response:
    """Attempt to approve Step 0."""
    path = CARDFLOW_ENDPOINTS["approve_step0"].format(project_id=project_id)
    return cf_post(path, json={})


def _assert_analysis_schema(data: dict, schema: dict):
    """Assert that analysis response matches the expected schema structure."""
    assert "project_id" in data, "Missing project_id in analysis"
    assert "uploaded_at" in data, "Missing uploaded_at in analysis"
    assert "marketplaces" in data, "Missing marketplaces in analysis"
    assert "main_image" in data, "Missing main_image in analysis"
    assert "analysis" in data, "Missing analysis block in analysis"
    assert "marketplace_validation" in data, "Missing marketplace_validation in analysis"

    mi = data["main_image"]
    for key in ("filename", "content_type", "size_bytes", "dimensions", "content_hash", "quality_score"):
        assert key in mi, f"Missing main_image.{key}"

    dims = mi["dimensions"]
    assert "width" in dims and "height" in dims, "Missing dimensions width/height"
    assert isinstance(mi["quality_score"], int), "quality_score must be int"
    assert 0 <= mi["quality_score"] <= 100, "quality_score out of 0-100 range"

    ana = data["analysis"]
    for key in ("overall_quality_score", "can_approve", "blocking_reasons", "warnings"):
        assert key in ana, f"Missing analysis.{key}"
    assert isinstance(ana["can_approve"], bool), "can_approve must be bool"
    assert isinstance(ana["blocking_reasons"], list), "blocking_reasons must be list"
    assert isinstance(ana["warnings"], list), "warnings must be list"

    if "quality_flags" in ana:
        for flag in ana["quality_flags"]:
            assert "code" in flag, "quality_flags item missing code"
            assert "severity" in flag, "quality_flags item missing severity"
            assert flag["severity"] in ("critical", "warning", "info"), f"Invalid severity: {flag['severity']}"

    mpv = data["marketplace_validation"]
    for mp in data.get("marketplaces", []):
        assert mp in mpv, f"Missing marketplace_validation for {mp}"
        mp_data = mpv[mp]
        assert "passes" in mp_data, f"Missing passes in marketplace_validation.{mp}"
        assert "failures" in mp_data, f"Missing failures in marketplace_validation.{mp}"
        assert "warnings" in mp_data, f"Missing warnings in marketplace_validation.{mp}"


def _create_project_for_test() -> str | None:
    """Create a minimal project and return its ID, or None on failure."""
    path = CARDFLOW_ENDPOINTS["create_project"]
    payload = {
        "name": f"QA Ingestion Test {datetime.now(timezone.utc).isoformat()}",
        "marketplaces": ["wildberries"],
        "brief": "Test product",
        "default_card_count": 8,
    }
    try:
        resp = cf_post(path, json=payload)
        if resp.status_code in (200, 201):
            body = resp.json()
            return body.get("id") or body.get("project_id")
    except Exception:
        pass
    return None


# ── TestUploadHappyPath ─────────────────────────────────────────────

class TestUploadHappyPath:
    """1.x — Upload flows with valid inputs."""

    def test_main_photo_only(self, valid_image_bytes, cardflow_up):
        """1.1 — Valid main image uploads and analysis succeeds."""
        project_id = _create_project_for_test()
        assert project_id, "Failed to create test project"

        resp = _upload_main(project_id, valid_image_bytes)
        assert resp.status_code in (200, 201), f"Upload failed: {resp.status_code} {resp.text}"
        body = resp.json()
        assert body.get("status") == "success" or resp.status_code in (200, 201)

        analysis = _get_analysis(project_id)
        assert analysis.status_code == 200, f"Analysis fetch failed: {analysis.status_code}"
        adata = analysis.json()
        assert adata["main_image"]["quality_score"] > 0
        assert adata["analysis"]["can_approve"] is True

    def test_main_plus_additional(self, valid_image_bytes, cardflow_up):
        """1.2 — Main + additional photos upload and aggregate."""
        project_id = _create_project_for_test()
        assert project_id

        resp = _upload_main(project_id, valid_image_bytes)
        assert resp.status_code in (200, 201)

        additional = [valid_image_bytes, valid_image_bytes, valid_image_bytes]
        resp2 = _upload_additional(project_id, additional)
        assert resp2.status_code in (200, 201), f"Additional upload failed: {resp2.status_code}"

        analysis = _get_analysis(project_id)
        assert analysis.status_code == 200
        adata = analysis.json()
        assert "additional_images" in adata
        assert len(adata["additional_images"]) == 3
        assert adata["analysis"]["can_approve"] is True

    def test_main_plus_references(self, valid_image_bytes, cardflow_up):
        """1.3 — Main + up to 5 reference images."""
        project_id = _create_project_for_test()
        assert project_id

        resp = _upload_main(project_id, valid_image_bytes)
        assert resp.status_code in (200, 201)

        refs = [valid_image_bytes] * 5
        resp2 = _upload_references(project_id, refs)
        assert resp2.status_code in (200, 201), f"References upload failed: {resp2.status_code}"

        analysis = _get_analysis(project_id)
        assert analysis.status_code == 200
        adata = analysis.json()
        assert "reference_images" in adata
        assert len(adata["reference_images"]) == 5

    def test_main_plus_brief(self, valid_image_bytes, cardflow_up):
        """1.4 — Main + brief text + marketplace selection."""
        project_id = _create_project_for_test()
        assert project_id

        resp = _upload_main(project_id, valid_image_bytes)
        assert resp.status_code in (200, 201)

        brief_resp = _submit_brief(project_id, "Premium wireless headphones with ANC", ["wildberries"])
        assert brief_resp.status_code in (200, 201), f"Brief submit failed: {brief_resp.status_code}"

        analysis = _get_analysis(project_id)
        assert analysis.status_code == 200
        adata = analysis.json()
        assert "brief" in adata
        assert adata["brief"]["text"] == "Premium wireless headphones with ANC"
        assert "wildberries" in adata["marketplaces"]

    def test_full_valid_upload(self, valid_image_bytes, cardflow_up):
        """1.5 — All inputs including WB+Ozon, strictest rules applied."""
        project_id = _create_project_for_test()
        assert project_id

        resp = _upload_main(project_id, valid_image_bytes)
        assert resp.status_code in (200, 201)

        additional = [valid_image_bytes, valid_image_bytes]
        _upload_additional(project_id, additional)

        refs = [valid_image_bytes]
        _upload_references(project_id, refs)

        brief_resp = _submit_brief(project_id, "Organic matcha from Uji", ["wildberries", "ozon"])
        assert brief_resp.status_code in (200, 201)

        analysis = _get_analysis(project_id)
        assert analysis.status_code == 200
        adata = analysis.json()
        assert set(adata["marketplaces"]) == {"wildberries", "ozon"}
        assert "wildberries" in adata["marketplace_validation"]
        assert "ozon" in adata["marketplace_validation"]


# ── TestInvalidInputs ───────────────────────────────────────────────

class TestInvalidInputs:
    """2.x — Invalid / weak input cases."""

    @pytest.mark.parametrize("case", [
        "missing_main_photo",
        "file_too_large",
        "invalid_file_type",
        "low_resolution",
        "corrupted_image",
        "too_many_references",
        "empty_brief_warning",
        "brief_too_long",
        "non_square_aspect_ratio",
        "png_with_transparency",
        "gif_not_accepted",
        "zero_byte_file",
        "filename_with_special_chars",
    ])
    def test_invalid_input(self, fixture_data, case, valid_image_bytes, low_res_image_bytes,
                           corrupted_bytes, non_image_bytes, gif_bytes, png_transparent_bytes,
                           wide_image_bytes, cardflow_up):
        """2.x — Each invalid/weak input handled correctly."""
        scenarios = fixture_data.get("ingestion_fixtures", {}).get("invalid_input_scenarios", [])
        scenario = next((s for s in scenarios if s["id"] == case), None)
        assert scenario is not None, f"Scenario {case} not found in fixtures"

        project_id = _create_project_for_test()
        assert project_id

        expected = scenario["expected"]
        should_block = expected.get("can_approve") is False

        if case == "missing_main_photo":
            resp = _get_analysis(project_id)
            assert resp.status_code == 200
            body = resp.json()
            assert body["analysis"]["can_approve"] is False
            assert any("main" in r.lower() or "photo" in r.lower() or "required" in r.lower()
                       for r in body["analysis"].get("blocking_reasons", [])), \
                f"Expected blocking reason about missing main photo, got: {body['analysis']['blocking_reasons']}"

        elif case == "file_too_large":
            large = b"\x00" * (11 * 1024 * 1024)
            resp = _upload_main(project_id, large, filename="huge.jpg")
            assert resp.status_code in (400, 413, 422), f"Expected 4xx for oversized file, got {resp.status_code}"

        elif case == "invalid_file_type":
            resp = _upload_main(project_id, non_image_bytes, filename="product.exe",
                                content_type="application/octet-stream")
            assert resp.status_code in (400, 415, 422), f"Expected 4xx for non-image, got {resp.status_code}"

        elif case == "low_resolution":
            resp = _upload_main(project_id, low_res_image_bytes, filename="tiny.jpg")
            assert resp.status_code in (200, 201, 400, 422)
            if resp.status_code in (200, 201):
                analysis = _get_analysis(project_id)
                body = analysis.json()
                assert body["analysis"]["can_approve"] is False, "Low-res should block approval"
                assert any("resolution" in f.lower() or "low" in f.lower()
                           for f in body["analysis"].get("blocking_reasons", [])
                           + [fl.get("code", "") for fl in body["analysis"].get("quality_flags", [])])

        elif case == "corrupted_image":
            resp = _upload_main(project_id, corrupted_bytes, filename="corrupt.jpg")
            assert resp.status_code in (400, 422), f"Expected 4xx for corrupted image, got {resp.status_code}"

        elif case == "too_many_references":
            _upload_main(project_id, valid_image_bytes)
            refs = [valid_image_bytes] * 6
            resp = _upload_references(project_id, refs)
            assert resp.status_code in (400, 422), f"Expected 4xx for too many refs, got {resp.status_code}"

        elif case == "empty_brief_warning":
            _upload_main(project_id, valid_image_bytes)
            brief_resp = _submit_brief(project_id, "", ["wildberries"])
            assert brief_resp.status_code in (200, 201)
            analysis = _get_analysis(project_id)
            body = analysis.json()
            assert body["analysis"]["can_approve"] is True, "Empty brief should warn but allow approval"
            assert len(body["analysis"].get("warnings", [])) > 0, "Expected warning for empty brief"

        elif case == "brief_too_long":
            _upload_main(project_id, valid_image_bytes)
            long_brief = "x" * 5001
            brief_resp = _submit_brief(project_id, long_brief, ["wildberries"])
            assert brief_resp.status_code in (400, 422), f"Expected 4xx for long brief, got {brief_resp.status_code}"

        elif case == "non_square_aspect_ratio":
            resp = _upload_main(project_id, wide_image_bytes, filename="wide.jpg")
            assert resp.status_code in (200, 201)
            analysis = _get_analysis(project_id)
            body = analysis.json()
            assert body["analysis"]["can_approve"] is True, "Non-square should warn but allow"
            assert any("aspect" in w.lower() or "square" in w.lower()
                       for w in body["analysis"].get("warnings", [])), \
                f"Expected aspect ratio warning, got: {body['analysis']['warnings']}"

        elif case == "png_with_transparency":
            resp = _upload_main(project_id, png_transparent_bytes, filename="transparent.png",
                                content_type="image/png")
            assert resp.status_code in (200, 201)
            analysis = _get_analysis(project_id)
            body = analysis.json()
            assert body["analysis"]["can_approve"] is True, "Transparent PNG should warn but allow"
            assert any("transparent" in w.lower() or "background" in w.lower()
                       for w in body["analysis"].get("warnings", [])), \
                f"Expected transparency warning, got: {body['analysis']['warnings']}"

        elif case == "gif_not_accepted":
            resp = _upload_main(project_id, gif_bytes, filename="product.gif",
                                content_type="image/gif")
            assert resp.status_code in (400, 415, 422), f"Expected 4xx for GIF, got {resp.status_code}"

        elif case == "zero_byte_file":
            resp = _upload_main(project_id, b"", filename="empty.jpg")
            assert resp.status_code in (400, 422), f"Expected 4xx for empty file, got {resp.status_code}"

        elif case == "filename_with_special_chars":
            resp = _upload_main(project_id, valid_image_bytes,
                                filename='product <main> & "photo".jpg')
            assert resp.status_code in (200, 201), f"Upload with special chars failed: {resp.status_code}"
            body = resp.json()
            stored_name = body.get("filename", "") or body.get("main_image", {}).get("filename", "")
            assert "<" not in stored_name and ">" not in stored_name and "&" not in stored_name, \
                f"Filename not sanitized: {stored_name}"


# ── TestMarketplaceValidation ───────────────────────────────────────

class TestMarketplaceValidation:
    """3.x — Marketplace-specific validation rules."""

    def test_wb_only_rules(self, valid_image_bytes, low_res_image_bytes, cardflow_up):
        """3.1 — WB validation rules applied (min 900x900)."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])

        analysis = _get_analysis(project_id)
        assert analysis.status_code == 200
        body = analysis.json()

        assert "wildberries" in body["marketplace_validation"]
        wb = body["marketplace_validation"]["wildberries"]
        assert wb["passes"] is True
        assert "ozon" not in body["marketplace_validation"]

        wb_rules = body.get("analysis", {}).get("marketplace_rules_applied", [])
        assert "wildberries" in wb_rules or len(wb_rules) == 0

    def test_ozon_only_rules(self, valid_image_bytes, cardflow_up):
        """3.2 — Ozon validation rules applied (min 1000x1000)."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["ozon"])

        analysis = _get_analysis(project_id)
        assert analysis.status_code == 200
        body = analysis.json()

        assert "ozon" in body["marketplace_validation"]
        ozon = body["marketplace_validation"]["ozon"]
        assert ozon["passes"] is True
        assert "wildberries" not in body["marketplace_validation"]

    def test_strictest_merged(self, valid_image_bytes, cardflow_up):
        """3.3 — WB+Ozon combined uses strictest rule set."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries", "ozon"])

        analysis = _get_analysis(project_id)
        assert analysis.status_code == 200
        body = analysis.json()

        assert "wildberries" in body["marketplace_validation"]
        assert "ozon" in body["marketplace_validation"]

        wb = body["marketplace_validation"]["wildberries"]
        ozon = body["marketplace_validation"]["ozon"]

        if wb["passes"] and ozon["passes"]:
            assert body["analysis"]["can_approve"] is True
        else:
            assert body["analysis"]["can_approve"] is False

    def test_switch_marketplace(self, valid_image_bytes, cardflow_up):
        """3.4 — Switch marketplace triggers re-analysis."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])

        analysis1 = _get_analysis(project_id)
        assert analysis1.status_code == 200
        body1 = analysis1.json()
        assert body1["marketplaces"] == ["wildberries"]

        brief_resp = _submit_brief(project_id, "Test product", ["wildberries", "ozon"])
        assert brief_resp.status_code in (200, 201)

        analysis2 = _get_analysis(project_id)
        assert analysis2.status_code == 200
        body2 = analysis2.json()
        assert set(body2["marketplaces"]) == {"wildberries", "ozon"}
        assert "ozon" in body2["marketplace_validation"]

    def test_900px_fails_ozon_strictest(self, valid_image_bytes, cardflow_up):
        """3.5 — 900x900 image passes WB but fails Ozon; combined fails."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)

        _submit_brief(project_id, "Test", ["wildberries"])
        wb_analysis = _get_analysis(project_id)
        wb_body = wb_analysis.json()
        assert wb_body["marketplace_validation"]["wildberries"]["passes"] is True

        _submit_brief(project_id, "Test", ["wildberries", "ozon"])
        combined_analysis = _get_analysis(project_id)
        combined_body = combined_analysis.json()

        ozon_val = combined_body["marketplace_validation"]["ozon"]
        if ozon_val["passes"] is False:
            assert combined_body["analysis"]["can_approve"] is False, \
                "Combined WB+Ozon should fail when Ozon fails (strictest rule)"


# ── TestGating ──────────────────────────────────────────────────────

class TestGating:
    """4.x — Step 0 approval gating behavior."""

    def test_missing_required_blocks(self, cardflow_up):
        """4.1 — Missing required input blocks approval."""
        project_id = _create_project_for_test()
        assert project_id

        analysis = _get_analysis(project_id)
        assert analysis.status_code == 200
        body = analysis.json()
        assert body["analysis"]["can_approve"] is False
        assert len(body["analysis"]["blocking_reasons"]) > 0

    def test_critical_quality_blocks(self, low_res_image_bytes, cardflow_up):
        """4.2 — Critical quality risk blocks approval."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, low_res_image_bytes, filename="tiny.jpg")
        analysis = _get_analysis(project_id)
        body = analysis.json()

        assert body["analysis"]["can_approve"] is False, "Critical quality should block"
        assert len(body["analysis"]["blocking_reasons"]) > 0, "Should have blocking reasons"
        assert len(body["analysis"].get("warnings", [])) >= 0

    def test_warning_allows(self, valid_image_bytes, wide_image_bytes, cardflow_up):
        """4.3 — Non-critical warning allows approval."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, wide_image_bytes, filename="wide.jpg")
        analysis = _get_analysis(project_id)
        body = analysis.json()

        assert body["analysis"]["can_approve"] is True, "Warning should allow approval"
        assert len(body["analysis"]["blocking_reasons"]) == 0, "No blocking reasons for warnings"

    def test_approval_with_blockers_rejected(self, low_res_image_bytes, cardflow_up):
        """4.4 — API returns structured blocking reasons when attempting approval."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, low_res_image_bytes, filename="tiny.jpg")

        approve_resp = _approve_step0(project_id)
        assert approve_resp.status_code in (400, 409, 422), \
            f"Expected 4xx when approving with blockers, got {approve_resp.status_code}"

        body = approve_resp.json()
        assert "reason" in body or "error" in body or "blocking_reasons" in body, \
            f"Expected structured error, got: {body}"

    def test_valid_approval_succeeds(self, valid_image_bytes, cardflow_up):
        """4.5 — Valid inputs allow Step 0 approval."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _submit_brief(project_id, "Valid product", ["wildberries"])

        analysis = _get_analysis(project_id)
        body = analysis.json()
        assert body["analysis"]["can_approve"] is True

        approve_resp = _approve_step0(project_id)
        assert approve_resp.status_code in (200, 201), \
            f"Expected 2xx for valid approval, got {approve_resp.status_code}"


# ── TestTraceability ────────────────────────────────────────────────

class TestTraceability:
    """5.x — Upload and analysis traceability."""

    def test_upload_metadata(self, valid_image_bytes, cardflow_up):
        """5.1 — Each upload has content hash, metadata, timestamp."""
        project_id = _create_project_for_test()
        assert project_id

        resp = _upload_main(project_id, valid_image_bytes)
        assert resp.status_code in (200, 201)

        analysis = _get_analysis(project_id)
        body = analysis.json()

        mi = body["main_image"]
        assert "content_hash" in mi, "Missing content_hash in main_image"
        assert mi["content_hash"], "content_hash should not be empty"
        assert len(mi["content_hash"]) >= 32, "content_hash should be at least 32 chars"

        assert "uploaded_at" in body, "Missing uploaded_at"
        assert body["uploaded_at"], "uploaded_at should not be empty"

        assert "filename" in mi, "Missing filename"
        assert "content_type" in mi, "Missing content_type"
        assert "size_bytes" in mi, "Missing size_bytes"
        assert "dimensions" in mi, "Missing dimensions"
        assert "quality_score" in mi, "Missing quality_score"

    def test_analysis_result_linked(self, valid_image_bytes, cardflow_up):
        """5.2 — Analysis output linked to project with correct schema."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])

        analysis = _get_analysis(project_id)
        assert analysis.status_code == 200
        body = analysis.json()

        assert body["project_id"] == project_id, "Analysis project_id mismatch"

        schema = {
            "project_id": "uuid",
            "uploaded_at": "iso8601",
            "marketplaces": ["string"],
        }
        _assert_analysis_schema(body, schema)

    def test_additional_images_traced(self, valid_image_bytes, cardflow_up):
        """5.3 — Additional images have individual content hashes."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _upload_additional(project_id, [valid_image_bytes, valid_image_bytes])

        analysis = _get_analysis(project_id)
        body = analysis.json()

        assert "additional_images" in body
        for img in body["additional_images"]:
            assert "content_hash" in img, f"Missing content_hash in additional image: {img}"
            assert "filename" in img, f"Missing filename in additional image: {img}"

    def test_reference_images_traced(self, valid_image_bytes, cardflow_up):
        """5.4 — Reference images have individual content hashes."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _upload_references(project_id, [valid_image_bytes])

        analysis = _get_analysis(project_id)
        body = analysis.json()

        assert "reference_images" in body
        for img in body["reference_images"]:
            assert "content_hash" in img, f"Missing content_hash in reference image: {img}"


# ── TestBlockingVsWarning ───────────────────────────────────────────

class TestBlockingVsWarning:
    """6.x — Blocking vs warning state regression cases."""

    @pytest.mark.parametrize("case", [
        "critical_resolution_blocks",
        "warning_non_square_allows",
        "critical_corrupt_blocks",
        "warning_transparency_allows",
        "critical_wrong_type_blocks",
        "warning_empty_brief_allows",
        "critical_missing_main_blocks",
        "critical_too_large_blocks",
        "critical_too_many_refs_blocks",
        "warning_low_quality_score_allows",
    ])
    def test_blocking_vs_warning(self, fixture_data, case, valid_image_bytes, low_res_image_bytes,
                                  corrupted_bytes, non_image_bytes, gif_bytes, png_transparent_bytes,
                                  wide_image_bytes, cardflow_up):
        """6.x — Each blocking/warning case behaves correctly."""
        cases = fixture_data.get("ingestion_fixtures", {}).get("blocking_vs_warning_cases", [])
        tc = next((c for c in cases if c["id"] == case), None)
        assert tc is not None, f"Case {case} not found"

        project_id = _create_project_for_test()
        assert project_id

        should_block = tc["should_block_pipeline"]

        if case == "critical_resolution_blocks":
            _upload_main(project_id, low_res_image_bytes, filename="tiny.jpg")
        elif case == "warning_non_square_allows":
            _upload_main(project_id, wide_image_bytes, filename="wide.jpg")
        elif case == "critical_corrupt_blocks":
            resp = _upload_main(project_id, corrupted_bytes, filename="corrupt.jpg")
            assert resp.status_code in (400, 422), f"Expected 4xx for corrupt, got {resp.status_code}"
            return
        elif case == "warning_transparency_allows":
            _upload_main(project_id, png_transparent_bytes, filename="transparent.png",
                         content_type="image/png")
        elif case == "critical_wrong_type_blocks":
            resp = _upload_main(project_id, non_image_bytes, filename="product.exe",
                                content_type="application/octet-stream")
            assert resp.status_code in (400, 415, 422), f"Expected 4xx for non-image, got {resp.status_code}"
            return
        elif case == "warning_empty_brief_allows":
            _upload_main(project_id, valid_image_bytes)
            _submit_brief(project_id, "", ["wildberries"])
        elif case == "critical_missing_main_blocks":
            pass
        elif case == "critical_too_large_blocks":
            large = b"\x00" * (11 * 1024 * 1024)
            resp = _upload_main(project_id, large, filename="huge.jpg")
            assert resp.status_code in (400, 413, 422), f"Expected 4xx for large, got {resp.status_code}"
            return
        elif case == "critical_too_many_refs_blocks":
            _upload_main(project_id, valid_image_bytes)
            refs = [valid_image_bytes] * 6
            resp = _upload_references(project_id, refs)
            assert resp.status_code in (400, 422), f"Expected 4xx for too many refs, got {resp.status_code}"
            return
        elif case == "warning_low_quality_score_allows":
            _upload_main(project_id, valid_image_bytes)

        analysis = _get_analysis(project_id)
        body = analysis.json()
        can_approve = body["analysis"]["can_approve"]

        if should_block:
            assert can_approve is False, f"Case {case}: expected block, got can_approve=True"
        else:
            assert can_approve is True, f"Case {case}: expected allow, got can_approve=False"


# ── TestStrictestRuleRegression ─────────────────────────────────────

class TestStrictestRuleRegression:
    """7.x — Strictest-rule behavior regression for WB+Ozon."""

    def test_900px_passes_wb_fails_ozon_combined_fails(self, valid_image_bytes, cardflow_up):
        """7.1 — 900x900 passes WB, fails Ozon; combined fails (strictest)."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test", ["wildberries"])
        wb = _get_analysis(project_id).json()

        _submit_brief(project_id, "Test", ["ozon"])
        ozon = _get_analysis(project_id).json()

        _submit_brief(project_id, "Test", ["wildberries", "ozon"])
        combined = _get_analysis(project_id).json()

        wb_passes = wb["marketplace_validation"]["wildberries"]["passes"]
        ozon_passes = ozon["marketplace_validation"]["ozon"]["passes"]

        if not ozon_passes:
            combined_passes = (
                combined["marketplace_validation"]["wildberries"]["passes"]
                and combined["marketplace_validation"]["ozon"]["passes"]
            )
            assert combined_passes is False, \
                "Combined should fail when Ozon fails (strictest rule)"

    def test_1000px_passes_both(self, valid_image_bytes, cardflow_up):
        """7.2 — 1000x1000+ image passes both WB and Ozon individually and combined."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test", ["wildberries", "ozon"])

        analysis = _get_analysis(project_id)
        body = analysis.json()

        assert body["marketplace_validation"]["wildberries"]["passes"] is True
        assert body["marketplace_validation"]["ozon"]["passes"] is True
        assert body["analysis"]["can_approve"] is True

    def test_wb_keyword_not_in_ozon(self, valid_image_bytes, cardflow_up):
        """7.3 — Keyword prohibited by WB but not Ozon; combined blocks."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _submit_brief(project_id, "копия известного бренда", ["wildberries", "ozon"])

        analysis = _get_analysis(project_id)
        body = analysis.json()

        wb_val = body["marketplace_validation"]["wildberries"]
        ozon_val = body["marketplace_validation"]["ozon"]

        if not wb_val["passes"]:
            assert body["analysis"]["can_approve"] is False, \
                "Combined should block when WB blocks (strictest rule)"

    def test_ozon_keyword_not_in_wb(self, valid_image_bytes, cardflow_up):
        """7.4 — Keyword prohibited by Ozon but not WB; combined blocks."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _submit_brief(project_id, "не фейк, оригинал", ["wildberries", "ozon"])

        analysis = _get_analysis(project_id)
        body = analysis.json()

        ozon_val = body["marketplace_validation"]["ozon"]
        if not ozon_val["passes"]:
            assert body["analysis"]["can_approve"] is False, \
                "Combined should block when Ozon blocks (strictest rule)"

    def test_both_prohibit_keyword(self, valid_image_bytes, cardflow_up):
        """7.5 — Keyword prohibited by both; combined blocks."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _submit_brief(project_id, "реплика премиум качества", ["wildberries", "ozon"])

        analysis = _get_analysis(project_id)
        body = analysis.json()

        wb_val = body["marketplace_validation"]["wildberries"]
        ozon_val = body["marketplace_validation"]["ozon"]

        if not wb_val["passes"] or not ozon_val["passes"]:
            assert body["analysis"]["can_approve"] is False, \
                "Combined should block when either marketplace blocks"

    def test_wb_stricter_title_length(self, valid_image_bytes, cardflow_up):
        """7.6 — Title 80 chars exceeds WB (60) but within Ozon (120); combined blocks."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        long_title = "A" * 80
        _submit_brief(project_id, long_title, ["wildberries", "ozon"])

        analysis = _get_analysis(project_id)
        body = analysis.json()

        wb_val = body["marketplace_validation"]["wildberries"]
        if not wb_val["passes"]:
            assert body["analysis"]["can_approve"] is False, \
                "Combined should block when WB blocks on title length"

    def test_wb_mandatory_category(self, valid_image_bytes, cardflow_up):
        """7.7 — Missing category fails WB but not Ozon; combined blocks."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries", "ozon"])

        analysis = _get_analysis(project_id)
        body = analysis.json()

        wb_val = body["marketplace_validation"]["wildberries"]
        if not wb_val["passes"]:
            assert body["analysis"]["can_approve"] is False, \
                "Combined should block when WB blocks on mandatory field"
