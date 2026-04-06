"""
CardFlow test configuration and shared fixtures.

Endpoints will be filled once the CardFlow app code lands.
Until then: all tests use skip() with the blocking dev-task id.
"""
import json
import os
from pathlib import Path
from typing import Any

import pytest
import requests

# ── Config ──────────────────────────────────────────────────────────
CARDFLOW_BASE_URL = os.environ.get("CF_BASE_URL", "http://localhost:8000")
CARDFLOW_AUTH_TOKEN = os.environ.get("CF_AUTH_TOKEN", "")

HEADERS = {
    "Authorization": f"Bearer {CARDFLOW_AUTH_TOKEN}",
    "Content-Type": "application/json",
}

# ── Endpoint placeholders (update once dev lands) ───────────────────
CARDFLOW_ENDPOINTS: dict[str, str] = {
    # Ingestion (Step 0)
    "upload_main": "/api/v1/projects/{project_id}/uploads/main",
    "upload_additional": "/api/v1/projects/{project_id}/uploads/additional",
    "upload_references": "/api/v1/projects/{project_id}/uploads/references",
    "upload_brief": "/api/v1/projects/{project_id}/brief",
    "analysis_result": "/api/v1/projects/{project_id}/analysis",
    "approve_step0": "/api/v1/projects/{project_id}/steps/0/approve",

    # Workflow stages
    "create_project": "/api/v1/projects",
    "get_project": "/api/v1/projects/{project_id}",
    "approve_stage": "/api/v1/projects/{project_id}/stages/{stage_id}/approve",
    "comment_stage": "/api/v1/projects/{project_id}/stages/{stage_id}/comment",
    "regenerate_stage": "/api/v1/projects/{project_id}/stages/{stage_id}/regenerate",
    "regenerate_card": "/api/v1/projects/{project_id}/cards/{card_id}/regenerate",
    "regenerate_element": "/api/v1/projects/{project_id}/cards/{card_id}/elements/{element_id}/regenerate",
    "batch_final": "/api/v1/projects/{project_id}/batch-final",
    "export": "/api/v1/projects/{project_id}/export",

    # Compliance
    "run_compliance": "/api/v1/projects/{project_id}/compliance/check",
    "compliance_report": "/api/v1/projects/{project_id}/compliance/report",

    # Revisions
    "list_revisions": "/api/v1/projects/{project_id}/cards/{card_id}/revisions",
    "get_revision": "/api/v1/projects/{project_id}/revisions/{revision_id}",
    "compare_revisions": "/api/v1/projects/{project_id}/cards/{card_id}/revisions/compare",
    "rollback_revision": "/api/v1/projects/{project_id}/cards/{card_id}/revisions/{revision_id}/rollback",

    # Audit
    "audit_log": "/api/v1/projects/{project_id}/audit",
}


# ── HTTP helper ─────────────────────────────────────────────────────
def cf_get(path: str, params: dict | None = None) -> requests.Response:
    return requests.get(f"{CARDFLOW_BASE_URL}{path}", headers=HEADERS, params=params)


def cf_post(path: str, json: dict | None = None, files: dict | None = None) -> requests.Response:
    if files:
        h = {k: v for k, v in HEADERS.items() if k != "Content-Type"}
        return requests.post(f"{CARDFLOW_BASE_URL}{path}", headers=h, files=files, data=json)
    return requests.post(f"{CARDFLOW_BASE_URL}{path}", headers=HEADERS, json=json)


def cf_patch(path: str, json: dict | None = None) -> requests.Response:
    return requests.patch(f"{CARDFLOW_BASE_URL}{path}", headers=HEADERS, json=json)


def cf_put(path: str, json: dict | None = None) -> requests.Response:
    return requests.put(f"{CARDFLOW_BASE_URL}{path}", headers=HEADERS, json=json)


def cf_delete(path: str) -> requests.Response:
    return requests.delete(f"{CARDFLOW_BASE_URL}{path}", headers=HEADERS)


# ── Shared fixtures ─────────────────────────────────────────────────
FIXTURE_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def fixture_data() -> dict[str, Any]:
    """Load all fixture definitions from JSON files."""
    data = {}
    for f in FIXTURE_DIR.glob("*.json"):
        with open(f) as fh:
            data[f.stem] = json.load(fh)
    return data


@pytest.fixture
def project_payload(fixture_data):
    """Minimal project creation payload."""
    return fixture_data.get("project_create", {
        "name": "Test Product",
        "marketplaces": ["wildberries"],
        "brief": "Test brief text",
        "default_card_count": 8,
    })


@pytest.fixture
def marketplace_combinations():
    """All marketplace selection combinations to test."""
    return [
        pytest.param(["wildberries"], id="wb-only"),
        pytest.param(["ozon"], id="ozon-only"),
        pytest.param(["wildberries", "ozon"], id="wb+ozon"),
    ]


@pytest.fixture
def cardflow_up():
    """Skip all tests if the CardFlow app isn't running yet."""
    import requests as _requests
    try:
        r = _requests.get(f"{CARDFLOW_BASE_URL}/healthz", timeout=3)
        if r.status_code != 200:
            pytest.skip("CardFlow app not running")
    except Exception:
        pytest.skip("CardFlow app not reachable (upstream dev task not landed yet)")


# ── Ingestion-specific fixtures ──────────────────────────────────────

@pytest.fixture
def ingestion_scenarios(fixture_data):
    """All upload scenario definitions from ingestion_fixtures.json."""
    return fixture_data.get("ingestion_fixtures", {}).get("upload_scenarios", {})


@pytest.fixture
def invalid_input_cases(fixture_data):
    """Invalid/weak input test cases from ingestion_fixtures.json."""
    return fixture_data.get("ingestion_fixtures", {}).get("invalid_input_scenarios", [])


@pytest.fixture
def marketplace_rules(fixture_data):
    """Per-marketplace rule definitions from ingestion_fixtures.json."""
    return fixture_data.get("ingestion_fixtures", {}).get("marketplace_rules", {})


@pytest.fixture
def quality_thresholds(fixture_data):
    """Quality score threshold definitions from ingestion_fixtures.json."""
    return fixture_data.get("ingestion_fixtures", {}).get("quality_thresholds", {})


@pytest.fixture
def analysis_schema(fixture_data):
    """Expected analysis result schema from ingestion_fixtures.json."""
    return fixture_data.get("ingestion_fixtures", {}).get("analysis_result_schema", {})


@pytest.fixture
def blocking_warning_cases(fixture_data):
    """Blocking vs warning state test cases from ingestion_fixtures.json."""
    return fixture_data.get("ingestion_fixtures", {}).get("blocking_vs_warning_cases", [])


@pytest.fixture
def regression_scenarios(fixture_data):
    """Regression test scenarios for strictest-rule behavior."""
    return fixture_data.get("ingestion_fixtures", {}).get("regression_scenarios", [])


@pytest.fixture
def valid_image_bytes():
    """Generate minimal valid JPEG bytes (1x1 pixel) for upload tests."""
    import io
    try:
        from PIL import Image
        buf = io.BytesIO()
        img = Image.new("RGB", (1200, 1200), color=(255, 255, 255))
        img.save(buf, format="JPEG", quality=95)
        return buf.getvalue()
    except ImportError:
        # Fallback: minimal valid JPEG header + padding
        return (
            b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
            b"\xff\xdb\x00\x43\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
            b"\xff\xc0\x00\x0b\x08\x04\xb0\x04\xb0\x01\x01\x11\x00"
            b"\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00"
            b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00\x7b\x40"
            b"\xff\xd9"
        )


@pytest.fixture
def low_res_image_bytes():
    """Generate a tiny (50x50) JPEG for low-resolution tests."""
    import io
    try:
        from PIL import Image
        buf = io.BytesIO()
        img = Image.new("RGB", (50, 50), color=(128, 128, 128))
        img.save(buf, format="JPEG", quality=50)
        return buf.getvalue()
    except ImportError:
        return b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"


@pytest.fixture
def wide_image_bytes():
    """Generate a wide (3000x1500) JPEG for non-square aspect ratio tests."""
    import io
    try:
        from PIL import Image
        buf = io.BytesIO()
        img = Image.new("RGB", (3000, 1500), color=(200, 200, 200))
        img.save(buf, format="JPEG", quality=90)
        return buf.getvalue()
    except ImportError:
        return b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"


@pytest.fixture
def png_transparent_bytes():
    """Generate a PNG with transparent background."""
    import io
    try:
        from PIL import Image
        buf = io.BytesIO()
        img = Image.new("RGBA", (1200, 1200), color=(0, 0, 0, 0))
        img.save(buf, format="PNG")
        return buf.getvalue()
    except ImportError:
        # Minimal PNG signature + IHDR
        return (
            b"\x89PNG\r\n\x1a\n"
            b"\x00\x00\x00\rIHDR\x00\x00\x04\xb0\x00\x00\x04\xb0\x08\x06\x00\x00\x00"
            b"\x00\x00\x00\x00IEND\xaeB`\x82"
        )


@pytest.fixture
def corrupted_bytes():
    """Generate corrupted/invalid image bytes."""
    return b"\x00\x00\x00\x00\x00NOT_A_VALID_IMAGE_FILE\x00\x00\x00\x00"


@pytest.fixture
def non_image_bytes():
    """Generate non-image file content (fake EXE)."""
    return b"MZ\x90\x00" + b"\x00" * 100


@pytest.fixture
def gif_bytes():
    """Generate minimal GIF bytes."""
    return b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
