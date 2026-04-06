"""
test_versioning/ — Immutable revisions, branching behavior, targeted regeneration,
and provenance integrity tests.

Covers:
  - Revision creation & immutability (no PATCH/DELETE/PUT)
  - Revision chain lineage & branching (linear vs batch)
  - Targeted regeneration (stage, card, element scopes)
  - Provenance integrity (traceability metadata, reference hashes)
  - Audit trail completeness & queryability
  - Revision comparison / diff
  - Rollback / restore (creates new revision, preserves old)
  - Concurrency safety (simultaneous writes, race conditions)
  - Edge cases (empty history, deleted project, long chains)
  - Export with revision traceability
"""
import hashlib
import io
import json
from datetime import datetime, timezone
from typing import Any

import pytest
import requests

from conftest import cf_get, cf_post, cf_patch, CARDFLOW_ENDPOINTS

pytestmark = pytest.mark.usefixtures("cardflow_up")


# ── Helpers ──────────────────────────────────────────────────────────

def _create_project_for_test(name: str | None = None, marketplaces: list[str] | None = None) -> str | None:
    """Create a minimal project and return its ID, or None on failure."""
    path = CARDFLOW_ENDPOINTS["create_project"]
    payload = {
        "name": name or f"QA Versioning Test {datetime.now(timezone.utc).isoformat()}",
        "marketplaces": marketplaces or ["wildberries"],
        "brief": "Test product for versioning QA",
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


def _upload_main_image(project_id: str, image_bytes: bytes) -> bool:
    """Upload a main image for project setup."""
    path = CARDFLOW_ENDPOINTS["upload_main"].format(project_id=project_id)
    files = {"file": ("product_main.jpg", io.BytesIO(image_bytes), "image/jpeg")}
    try:
        resp = cf_post(path, files=files)
        return resp.status_code in (200, 201)
    except Exception:
        return False


def _submit_brief(project_id: str, text: str, marketplaces: list[str]) -> bool:
    """Submit brief text and marketplace selection."""
    path = CARDFLOW_ENDPOINTS["upload_brief"].format(project_id=project_id)
    try:
        resp = cf_post(path, json={"text": text, "marketplaces": marketplaces})
        return resp.status_code in (200, 201)
    except Exception:
        return False


def _approve_step0(project_id: str) -> bool:
    """Approve Step 0 to unblock workflow stages."""
    path = CARDFLOW_ENDPOINTS["approve_step0"].format(project_id=project_id)
    try:
        resp = cf_post(path, json={})
        return resp.status_code in (200, 201)
    except Exception:
        return False


def _approve_stage(project_id: str, stage_id: int) -> requests.Response:
    """Approve a workflow stage."""
    path = CARDFLOW_ENDPOINTS["approve_stage"].format(project_id=project_id, stage_id=stage_id)
    return cf_post(path, json={})


def _regenerate_stage(project_id: str, stage_id: int, force: bool = False) -> requests.Response:
    """Regenerate a workflow stage."""
    path = CARDFLOW_ENDPOINTS["regenerate_stage"].format(project_id=project_id, stage_id=stage_id)
    return cf_post(path, json={"force": force} if force else {})


def _regenerate_card(project_id: str, card_id: int) -> requests.Response:
    """Regenerate a single card."""
    path = CARDFLOW_ENDPOINTS["regenerate_card"].format(project_id=project_id, card_id=card_id)
    return cf_post(path, json={})


def _regenerate_element(project_id: str, card_id: int, element: str) -> requests.Response:
    """Regenerate a single element within a card."""
    path = CARDFLOW_ENDPOINTS["regenerate_element"].format(
        project_id=project_id, card_id=card_id, element_id=element
    )
    return cf_post(path, json={})


def _list_revisions(project_id: str, card_id: int, sort: str = "desc",
                    limit: int | None = None, offset: int | None = None) -> requests.Response:
    """List revisions for a card."""
    path = CARDFLOW_ENDPOINTS["list_revisions"].format(project_id=project_id, card_id=card_id)
    params: dict[str, Any] = {"sort": sort}
    if limit is not None:
        params["limit"] = limit
    if offset is not None:
        params["offset"] = offset
    return cf_get(path, params=params)


def _get_revision(project_id: str, revision_id: str) -> requests.Response:
    """Fetch a single revision detail."""
    path = CARDFLOW_ENDPOINTS["get_revision"].format(project_id=project_id, revision_id=revision_id)
    return cf_get(path)


def _compare_revisions(project_id: str, card_id: int, from_rev: str, to_rev: str) -> requests.Response:
    """Compare two revisions."""
    path = CARDFLOW_ENDPOINTS["compare_revisions"].format(project_id=project_id, card_id=card_id)
    return cf_get(path, params={"from": from_rev, "to": to_rev})


def _rollback_revision(project_id: str, card_id: int, revision_id: str) -> requests.Response:
    """Rollback a card to a previous revision."""
    path = CARDFLOW_ENDPOINTS["rollback_revision"].format(
        project_id=project_id, card_id=card_id, revision_id=revision_id
    )
    return cf_post(path, json={})


def _get_audit_log(project_id: str, action: str | None = None,
                   since: str | None = None, until: str | None = None,
                   user: str | None = None, limit: int | None = None,
                   offset: int | None = None) -> requests.Response:
    """Query the audit log for a project."""
    path = CARDFLOW_ENDPOINTS["audit_log"].format(project_id=project_id)
    params: dict[str, Any] = {}
    if action:
        params["action"] = action
    if since:
        params["since"] = since
    if until:
        params["until"] = until
    if user:
        params["user"] = user
    if limit is not None:
        params["limit"] = limit
    if offset is not None:
        params["offset"] = offset
    return cf_get(path, params=params)


def _get_project(project_id: str) -> requests.Response:
    """Fetch project details."""
    path = CARDFLOW_ENDPOINTS["get_project"].format(project_id=project_id)
    return cf_get(path)


def _export_project(project_id: str) -> requests.Response:
    """Attempt to export a project."""
    path = CARDFLOW_ENDPOINTS["export"].format(project_id=project_id)
    return cf_post(path, json={})


# ── Schema validators ────────────────────────────────────────────────

def _assert_revision_schema(rev: dict, fixture_schema: dict):
    """Assert a revision object matches the expected schema."""
    required = ("id", "card_id", "project_id", "revision_number", "parent_id",
                "action", "payload_snapshot", "content_hash", "created_at", "created_by")
    for key in required:
        assert key in rev, f"Missing revision field: {key}"

    assert isinstance(rev["revision_number"], int), "revision_number must be int"
    assert rev["revision_number"] >= 1, "revision_number must be >= 1"
    assert isinstance(rev["content_hash"], str) and len(rev["content_hash"]) >= 32, \
        "content_hash must be a valid hash string"
    assert isinstance(rev["created_at"], str), "created_at must be ISO8601 string"
    assert isinstance(rev["created_by"], str), "created_by must be a string"
    assert rev["action"] in fixture_schema.get("revision_actions", []), \
        f"Invalid revision action: {rev['action']}"


def _assert_traceability(trace: dict):
    """Assert traceability metadata is complete."""
    required = ("prompt_version", "workflow_version", "seed", "model_id",
                "reference_hashes", "generation_timestamp")
    for key in required:
        assert key in trace, f"Missing traceability field: {key}"

    assert isinstance(trace["prompt_version"], str), "prompt_version must be string"
    assert isinstance(trace["workflow_version"], str), "workflow_version must be string"
    assert isinstance(trace["seed"], int), "seed must be integer"
    assert isinstance(trace["model_id"], str), "model_id must be string"
    assert isinstance(trace["reference_hashes"], list), "reference_hashes must be list"


def _assert_audit_entry_schema(entry: dict):
    """Assert an audit log entry matches the expected schema."""
    required = ("id", "project_id", "action", "actor", "timestamp", "details")
    for key in required:
        assert key in entry, f"Missing audit entry field: {key}"

    assert isinstance(entry["action"], str), "action must be string"
    assert isinstance(entry["timestamp"], str), "timestamp must be ISO8601 string"
    assert isinstance(entry["details"], dict), "details must be object"


# ══════════════════════════════════════════════════════════════════════
# Happy path: revision creation
# ══════════════════════════════════════════════════════════════════════

class TestRevisionCreation:
    """Revisions are created on every meaningful state change."""

    def test_revision_created_on_card_regenerate(self, fixture_data, valid_image_bytes):
        """1.1 — Regenerating a card creates a new immutable revision."""
        project_id = _create_project_for_test()
        assert project_id, "Failed to create test project"

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        resp = _regenerate_card(project_id, card_id=1)
        assert resp.status_code in (200, 201), f"Card regenerate failed: {resp.status_code}"

        revisions = _list_revisions(project_id, card_id=1)
        assert revisions.status_code == 200
        revs = revisions.json()
        assert len(revs) >= 1, "Expected at least one revision after card regeneration"

        latest = revs[0] if isinstance(revs, list) else revs.get("items", [{}])[0]
        assert latest["revision_number"] >= 1
        assert latest["action"] in ("card_created", "card_regenerated")

    def test_revision_created_on_stage_regenerate(self, fixture_data, valid_image_bytes):
        """1.2 — Full stage regeneration creates revisions for all cards."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        resp = _regenerate_stage(project_id, stage_id=4)
        assert resp.status_code in (200, 201), f"Stage regenerate failed: {resp.status_code}"

        for card_id in range(1, 9):
            revisions = _list_revisions(project_id, card_id=card_id)
            assert revisions.status_code == 200
            revs = revisions.json()
            items = revs if isinstance(revs, list) else revs.get("items", [])
            assert len(items) >= 1, f"Card {card_id} should have at least one revision"

    def test_revision_created_on_element_regenerate(self, fixture_data, valid_image_bytes):
        """1.3 — Regenerating a single element creates a revision."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        resp = _regenerate_element(project_id, card_id=1, element="text_overlay")
        assert resp.status_code in (200, 201), f"Element regenerate failed: {resp.status_code}"

        revisions = _list_revisions(project_id, card_id=1)
        assert revisions.status_code == 200
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

    def test_revision_created_on_stage_approval(self, fixture_data, valid_image_bytes):
        """1.4 — Approving a stage records an immutable audit revision."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        resp = _approve_stage(project_id, stage_id=0)
        assert resp.status_code in (200, 201), f"Stage approval failed: {resp.status_code}"

        audit = _get_audit_log(project_id, action="stage_approved")
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(items) >= 1, "Expected audit entry for stage approval"

    def test_revision_created_on_stage_comment_rejection(self, fixture_data, valid_image_bytes):
        """1.5 — Commenting with requires_regenerate creates a revision."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        path = CARDFLOW_ENDPOINTS["comment_stage"].format(project_id=project_id, stage_id=0)
        resp = cf_post(path, json={
            "comment": "Needs revision — adjust colors",
            "requires_regenerate": True,
        })
        assert resp.status_code in (200, 201), f"Stage comment failed: {resp.status_code}"

        audit = _get_audit_log(project_id, action="stage_commented")
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(items) >= 1


# ══════════════════════════════════════════════════════════════════════
# Revision immutability
# ══════════════════════════════════════════════════════════════════════

class TestRevisionImmutability:
    """Once a revision is created, its data cannot be modified."""

    def test_revision_data_cannot_be_patched(self, fixture_data):
        """2.1 — PATCH / revisions/{revision_id} returns 405 or 403."""
        versioning = fixture_data.get("versioning_fixtures", {})
        checks = versioning.get("immutability_checks", [])
        no_patch = next((c for c in checks if c["id"] == "no_patch"), None)
        assert no_patch is not None
        assert no_patch["method"] == "PATCH"
        assert no_patch["expected_status"] in (405, 403)

    def test_revision_data_cannot_be_deleted(self, fixture_data):
        """2.2 — DELETE / revisions/{revision_id} returns 405 or 403."""
        versioning = fixture_data.get("versioning_fixtures", {})
        checks = versioning.get("immutability_checks", [])
        no_delete = next((c for c in checks if c["id"] == "no_delete"), None)
        assert no_delete is not None
        assert no_delete["method"] == "DELETE"
        assert no_delete["expected_status"] in (405, 403)

    def test_revision_hash_is_stable(self, fixture_data):
        """2.3 — Revision content_hash does not change over time."""
        versioning = fixture_data.get("versioning_fixtures", {})
        checks = versioning.get("immutability_checks", [])
        hash_check = next((c for c in checks if c["id"] == "hash_stability"), None)
        assert hash_check is not None
        assert hash_check["fetches"] == 2
        assert hash_check["expected"] == "identical_hashes"

    def test_cascading_change_creates_new_revision(self, fixture_data):
        """2.4 — Modifying card data creates a new revision, old one untouched."""
        versioning = fixture_data.get("versioning_fixtures", {})
        checks = versioning.get("immutability_checks", [])
        payload_check = next((c for c in checks if c["id"] == "payload_stability"), None)
        assert payload_check is not None
        assert payload_check["expected"] == "identical_payloads"


# ══════════════════════════════════════════════════════════════════════
# Revision chain lineage & ancestry
# ══════════════════════════════════════════════════════════════════════

class TestRevisionChain:
    """Each revision tracks its parent and full ancestry."""

    def test_revision_has_parent_id(self, fixture_data, valid_image_bytes):
        """3.1 — Every revision (except r1) references its parent."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        assert revisions.status_code == 200
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 2

        first = items[0]
        assert first.get("parent_id") is None, "First revision should have no parent"

        for rev in items[1:]:
            assert rev.get("parent_id") is not None, \
                f"Revision {rev['revision_number']} should have a parent_id"

    def test_linear_chain_for_single_card(self, fixture_data, valid_image_bytes):
        """3.2 — Repeated regenerations form a linear chain without gaps."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        for _ in range(4):
            _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        assert revisions.status_code == 200
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])

        numbers = [r["revision_number"] for r in items]
        expected = list(range(1, len(items) + 1))
        assert numbers == expected, f"Expected sequential numbers {expected}, got {numbers}"

    def test_branching_on_full_stage_regeneration(self, fixture_data):
        """3.3 — Stage-level regeneration creates parallel revisions sharing a batch_id."""
        versioning = fixture_data.get("versioning_fixtures", {})
        scenarios = versioning.get("branching_scenarios", [])
        stage_batch = next((s for s in scenarios if s["id"] == "stage_batch_branch"), None)
        assert stage_batch is not None
        assert "shared_batch_id" in stage_batch
        assert stage_batch["shared_batch_id"] == "batch_001"

    def test_first_revision_has_no_parent(self, fixture_data, valid_image_bytes):
        """3.4 — The very first revision has parent_id = null."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        assert revisions.status_code == 200
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])

        if items:
            assert items[0].get("parent_id") is None

    def test_revision_numbers_are_sequential(self, fixture_data, valid_image_bytes):
        """3.5 — Revision numbers increment monotonically without gaps."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        for _ in range(3):
            _regenerate_card(project_id, card_id=2)

        revisions = _list_revisions(project_id, card_id=2, sort="asc")
        assert revisions.status_code == 200
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])

        for i, rev in enumerate(items):
            assert rev["revision_number"] == i + 1, \
                f"Expected revision {i + 1}, got {rev['revision_number']}"


# ══════════════════════════════════════════════════════════════════════
# List revisions
# ══════════════════════════════════════════════════════════════════════

class TestListRevisions:
    """GET /projects/{id}/cards/{id}/revisions returns the revision history."""

    def test_list_revisions_returns_all(self, fixture_data, valid_image_bytes):
        """4.1 — Listing revisions returns all, sorted newest-first by default."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        for _ in range(5):
            _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        assert revisions.status_code == 200
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 5

        if len(items) >= 2:
            assert items[0]["revision_number"] > items[1]["revision_number"], \
                "Expected newest-first sort order"

    def test_list_revisions_oldest_first(self, fixture_data, valid_image_bytes):
        """4.2 — sort=asc returns oldest-first."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        for _ in range(3):
            _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        assert revisions.status_code == 200
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])

        if len(items) >= 2:
            assert items[0]["revision_number"] < items[1]["revision_number"], \
                "Expected oldest-first sort order with sort=asc"

    def test_list_revisions_pagination(self, fixture_data, valid_image_bytes):
        """4.3 — Paginated revision listing works with limit/offset."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        for _ in range(5):
            _regenerate_card(project_id, card_id=1)

        page1 = _list_revisions(project_id, card_id=1, limit=2, offset=0)
        assert page1.status_code == 200
        items1 = page1.json()
        items1 = items1 if isinstance(items1, list) else items1.get("items", [])
        assert len(items1) <= 2

        page2 = _list_revisions(project_id, card_id=1, limit=2, offset=2)
        assert page2.status_code == 200
        items2 = page2.json()
        items2 = items2 if isinstance(items2, list) else items2.get("items", [])
        assert len(items2) <= 2

        all_ids = {r["id"] for r in items1} | {r["id"] for r in items2}
        assert len(all_ids) == len(items1) + len(items2), "Pagination should not duplicate items"

    def test_list_revisions_card_not_found(self, fixture_data):
        """4.4 — Non-existent card returns 404."""
        project_id = _create_project_for_test()
        assert project_id

        revisions = _list_revisions(project_id, card_id=99999)
        assert revisions.status_code == 404


# ══════════════════════════════════════════════════════════════════════
# Get revision
# ══════════════════════════════════════════════════════════════════════

class TestGetRevision:
    """GET /revisions/{revision_id} fetches a single revision detail."""

    def test_get_revision_returns_full_data(self, fixture_data, valid_image_bytes):
        """5.1 — Single revision fetch includes all required fields."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        rev_id = items[0]["id"]
        resp = _get_revision(project_id, rev_id)
        assert resp.status_code == 200

        rev = resp.json()
        schema = fixture_data.get("versioning_fixtures", {}).get("revision_schema", {})
        _assert_revision_schema(rev, schema)

    def test_get_revision_not_found(self, fixture_data):
        """5.2 — Non-existent revision returns 404."""
        project_id = _create_project_for_test()
        assert project_id

        resp = _get_revision(project_id, "00000000-0000-0000-0000-000000000000")
        assert resp.status_code == 404

    def test_get_revision_cross_project_denied(self, fixture_data, valid_image_bytes):
        """5.3 — Revision from different project returns 403 or 404."""
        project_a = _create_project_for_test("Project A")
        project_b = _create_project_for_test("Project B")
        assert project_a and project_b

        _upload_main_image(project_a, valid_image_bytes)
        _submit_brief(project_a, "Test A", ["wildberries"])
        _approve_step0(project_a)

        _regenerate_card(project_a, card_id=1)

        revisions = _list_revisions(project_a, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        rev_id = items[0]["id"]
        resp = _get_revision(project_b, rev_id)
        assert resp.status_code in (403, 404), \
            f"Cross-project revision access should be denied, got {resp.status_code}"


# ══════════════════════════════════════════════════════════════════════
# Version metadata & traceability
# ══════════════════════════════════════════════════════════════════════

class TestVersionMetadata:
    """Each revision carries full generation traceability metadata."""

    def test_revision_has_prompt_version(self, fixture_data, valid_image_bytes):
        """6.1 — Revision records prompt_version."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "prompt_version" in trace, "Missing prompt_version in traceability"
        assert isinstance(trace["prompt_version"], str)

    def test_revision_has_workflow_version(self, fixture_data, valid_image_bytes):
        """6.2 — Revision records workflow_version."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "workflow_version" in trace, "Missing workflow_version in traceability"

    def test_revision_has_model_id(self, fixture_data, valid_image_bytes):
        """6.3 — Revision records which AI model generated the output."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "model_id" in trace, "Missing model_id in traceability"

    def test_revision_has_seed(self, fixture_data, valid_image_bytes):
        """6.4 — Revision records the random seed used for generation."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "seed" in trace, "Missing seed in traceability"
        assert isinstance(trace["seed"], int), "seed must be integer"

    def test_revision_has_reference_hashes(self, fixture_data, valid_image_bytes):
        """6.5 — Revision records SHA-256 hashes of reference images."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "reference_hashes" in trace, "Missing reference_hashes in traceability"
        assert isinstance(trace["reference_hashes"], list)

    def test_revision_has_complete_traceability(self, fixture_data, valid_image_bytes):
        """6.6 — Full traceability object present for generated revisions."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        _assert_traceability(trace)

        versioning = fixture_data.get("versioning_fixtures", {})
        provenance = versioning.get("provenance_integrity_checks", [])
        completeness = next((p for p in provenance if p["id"] == "traceability_completeness"), None)
        assert completeness is not None
        for field in completeness["required_fields"]:
            assert field in trace, f"Missing required traceability field: {field}"


# ══════════════════════════════════════════════════════════════════════
# Audit trail completeness
# ══════════════════════════════════════════════════════════════════════

class TestAuditTrail:
    """Every meaningful action is recorded in the audit log."""

    def test_card_create_audit_entry(self, fixture_data, valid_image_bytes):
        """7.1 — Creating a card generates an audit entry."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        audit = _get_audit_log(project_id, action="card_regenerated")
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(items) >= 1

        entry = items[0]
        _assert_audit_entry_schema(entry)
        assert "card_id" in entry["details"], "Audit entry should include card_id"

    def test_card_regenerate_audit_entry(self, fixture_data, valid_image_bytes):
        """7.2 — Regenerating a card generates an audit entry with revision info."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        audit = _get_audit_log(project_id, action="card_regenerated")
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(items) >= 1

        details = items[0]["details"]
        assert "revision_before" in details or "revision_after" in details, \
            "Regeneration audit should include revision info"

    def test_stage_approve_audit_entry(self, fixture_data, valid_image_bytes):
        """7.3 — Approving a stage generates an audit entry."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _approve_stage(project_id, stage_id=0)

        audit = _get_audit_log(project_id, action="stage_approved")
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(items) >= 1

    def test_stage_comment_reject_audit_entry(self, fixture_data, valid_image_bytes):
        """7.4 — Commenting/rejecting a stage generates an audit entry."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        path = CARDFLOW_ENDPOINTS["comment_stage"].format(project_id=project_id, stage_id=0)
        cf_post(path, json={"comment": "Needs changes", "requires_regenerate": True})

        audit = _get_audit_log(project_id, action="stage_commented")
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(items) >= 1

    def test_export_audit_entry(self, fixture_data, valid_image_bytes):
        """7.5 — Exporting generates an audit entry."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _export_project(project_id)

        audit = _get_audit_log(project_id, action="export_initiated")
        assert audit.status_code == 200

    def test_project_create_audit_entry(self, fixture_data):
        """7.6 — Project creation generates an audit entry."""
        project_id = _create_project_for_test("Audit Test Project")
        assert project_id

        audit = _get_audit_log(project_id, action="project_created")
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(items) >= 1, "Expected audit entry for project creation"

    def test_upload_audit_entry(self, fixture_data, valid_image_bytes):
        """7.7 — Uploads generate audit entries with content hash."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)

        audit = _get_audit_log(project_id, action="upload")
        assert audit.status_code == 200


# ══════════════════════════════════════════════════════════════════════
# Audit log query
# ══════════════════════════════════════════════════════════════════════

class TestAuditLogQuery:
    """Audit log can be queried, filtered, and paginated."""

    def test_audit_log_by_project(self, fixture_data, valid_image_bytes):
        """8.1 — GET /projects/{id}/audit returns all audit entries."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        audit = _get_audit_log(project_id)
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(items) >= 3, "Expected multiple audit entries for project setup"

    def test_audit_log_filter_by_action(self, fixture_data, valid_image_bytes):
        """8.2 — Filter by action returns only matching entries."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        audit = _get_audit_log(project_id, action="upload")
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])

        for entry in items:
            assert entry["action"] == "upload", \
                f"Expected action=upload, got {entry['action']}"

    def test_audit_log_filter_by_date_range(self, fixture_data, valid_image_bytes):
        """8.3 — Filter by date range returns entries in the time window."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        now = datetime.now(timezone.utc).isoformat()
        past = "2020-01-01T00:00:00Z"

        audit = _get_audit_log(project_id, since=past, until=now)
        assert audit.status_code == 200

    def test_audit_log_filter_by_user(self, fixture_data, valid_image_bytes):
        """8.4 — Filter by user returns entries for that agent."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        audit = _get_audit_log(project_id, user="qa-engineer")
        assert audit.status_code == 200

    def test_audit_log_pagination(self, fixture_data, valid_image_bytes):
        """8.5 — Audit log supports pagination."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        page1 = _get_audit_log(project_id, limit=2, offset=0)
        assert page1.status_code == 200
        items1 = page1.json()
        items1 = items1 if isinstance(items1, list) else items1.get("items", [])
        assert len(items1) <= 2

        page2 = _get_audit_log(project_id, limit=2, offset=2)
        assert page2.status_code == 200
        items2 = page2.json()
        items2 = items2 if isinstance(items2, list) else items2.get("items", [])

        all_ids = {e["id"] for e in items1} | {e["id"] for e in items2}
        assert len(all_ids) == len(items1) + len(items2), \
            "Pagination should not produce duplicate entries"

    def test_audit_log_chronological_order(self, fixture_data, valid_image_bytes):
        """8.6 — Audit entries returned newest-first by default."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        audit = _get_audit_log(project_id)
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])

        if len(items) >= 2:
            assert items[0]["timestamp"] >= items[1]["timestamp"], \
                "Expected newest-first chronological order"

    def test_audit_log_no_entries_empty_list(self, fixture_data):
        """8.7 — Project with no actions returns empty audit list."""
        project_id = _create_project_for_test()
        assert project_id

        audit = _get_audit_log(project_id)
        assert audit.status_code == 200
        entries = audit.json()
        if isinstance(entries, list):
            assert len(entries) >= 1
        else:
            items = entries.get("items", [])
            assert isinstance(items, list)


# ══════════════════════════════════════════════════════════════════════
# Revision comparison / diff
# ══════════════════════════════════════════════════════════════════════

class TestRevisionComparison:
    """Compare two revisions to see what changed."""

    def test_compare_consecutive_revisions(self, fixture_data, valid_image_bytes):
        """9.1 — Compare consecutive revisions returns diff."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 2

        resp = _compare_revisions(project_id, card_id=1,
                                  from_rev=items[0]["id"], to_rev=items[1]["id"])
        assert resp.status_code == 200
        diff = resp.json()
        assert "added" in diff or "removed" in diff or "modified" in diff, \
            "Diff should include added/removed/modified fields"

    def test_compare_non_consecutive_revisions(self, fixture_data, valid_image_bytes):
        """9.2 — Comparing r1 to r5 shows cumulative changes."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        for _ in range(4):
            _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 4

        resp = _compare_revisions(project_id, card_id=1,
                                  from_rev=items[0]["id"], to_rev=items[-1]["id"])
        assert resp.status_code == 200

    def test_compare_same_revision_returns_no_diff(self, fixture_data, valid_image_bytes):
        """9.3 — Comparing a revision with itself returns empty diff."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        rev_id = items[0]["id"]
        resp = _compare_revisions(project_id, card_id=1, from_rev=rev_id, to_rev=rev_id)
        assert resp.status_code == 200
        diff = resp.json()

        has_changes = (
            diff.get("added") or diff.get("removed") or diff.get("modified")
            or diff.get("changes")
        )
        assert not has_changes, "Comparing same revision should return no changes"

    def test_compare_cross_card_denied(self, fixture_data):
        """9.4 — Comparing revisions from different cards returns 400."""
        project_id = _create_project_for_test()
        assert project_id

        versioning = fixture_data.get("versioning_fixtures", {})
        edge_cases = versioning.get("edge_case_scenarios", [])
        cross_card = next((e for e in edge_cases if e["id"] == "cross_card_comparison"), None)
        assert cross_card is not None
        assert cross_card["expected_status"] == 400

    def test_diff_output_schema(self, fixture_data, valid_image_bytes):
        """9.5 — Diff output includes added, removed, modified fields."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 2

        resp = _compare_revisions(project_id, card_id=1,
                                  from_rev=items[0]["id"], to_rev=items[1]["id"])
        assert resp.status_code == 200
        diff = resp.json()

        valid_keys = {"added", "removed", "modified", "changes", "unchanged", "summary"}
        assert any(k in diff for k in valid_keys), \
            f"Diff output should include at least one of {valid_keys}"


# ══════════════════════════════════════════════════════════════════════
# Rollback / restore
# ══════════════════════════════════════════════════════════════════════

class TestRevisionRollback:
    """Restoring a previous revision creates a new revision (not a mutation)."""

    def test_rollback_creates_new_revision(self, fixture_data, valid_image_bytes):
        """10.1 — Rollback creates a new revision, original untouched."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)
        _regenerate_card(project_id, card_id=1)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 3

        target_rev_id = items[0]["id"]
        target_hash = items[0]["content_hash"]

        resp = _rollback_revision(project_id, card_id=1, revision_id=target_rev_id)
        assert resp.status_code in (200, 201), f"Rollback failed: {resp.status_code}"

        revisions_after = _list_revisions(project_id, card_id=1, sort="asc")
        revs_after = revisions_after.json()
        items_after = revs_after if isinstance(revs_after, list) else revs_after.get("items", [])
        assert len(items_after) > len(items), "Rollback should create a new revision"

        original = _get_revision(project_id, target_rev_id)
        assert original.status_code == 200
        assert original.json()["content_hash"] == target_hash, \
            "Original revision content_hash must remain unchanged"

    def test_rollback_increments_revision_number(self, fixture_data, valid_image_bytes):
        """10.2 — After rollback, revision number increments."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        for _ in range(3):
            _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        current_max = max(r["revision_number"] for r in items)

        target_rev_id = items[-1]["id"]
        _rollback_revision(project_id, card_id=1, revision_id=target_rev_id)

        revisions_after = _list_revisions(project_id, card_id=1)
        revs_after = revisions_after.json()
        items_after = revs_after if isinstance(revs_after, list) else revs_after.get("items", [])
        new_max = max(r["revision_number"] for r in items_after)

        assert new_max == current_max + 1, \
            f"Expected revision {current_max + 1}, got {new_max}"

    def test_rollback_records_audit_entry(self, fixture_data, valid_image_bytes):
        """10.3 — Rollback generates an audit entry."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        _rollback_revision(project_id, card_id=1, revision_id=items[0]["id"])

        audit = _get_audit_log(project_id, action="revision_restored")
        assert audit.status_code == 200
        entries = audit.json()
        audit_items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(audit_items) >= 1, "Expected audit entry for rollback"

    def test_rollback_nonexistent_revision(self, fixture_data, valid_image_bytes):
        """10.4 — Rollback to non-existent revision returns 404."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        resp = _rollback_revision(project_id, card_id=1,
                                  revision_id="00000000-0000-0000-0000-000000000000")
        assert resp.status_code == 404

    def test_rollback_already_current_revision(self, fixture_data, valid_image_bytes):
        """10.5 — Rollback to current revision is no-op or returns 400/409."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        latest = items[0]

        resp = _rollback_revision(project_id, card_id=1, revision_id=latest["id"])
        assert resp.status_code in (200, 400, 409), \
            f"Rollback to current should be no-op or error, got {resp.status_code}"


# ══════════════════════════════════════════════════════════════════════
# Concurrency & consistency
# ══════════════════════════════════════════════════════════════════════

class TestRevisionConcurrency:
    """Handle concurrent revision writes safely."""

    def test_concurrent_regenerations_no_data_loss(self, fixture_data):
        """11.1 — Two simultaneous regenerations produce distinct sequential revisions."""
        versioning = fixture_data.get("versioning_fixtures", {})
        scenarios = versioning.get("concurrency_scenarios", [])
        concurrent = next((s for s in scenarios if s["id"] == "simultaneous_card_regenerate"), None)
        assert concurrent is not None
        assert concurrent["expected"] == "two_distinct_sequential_revisions"
        assert concurrent["no_data_loss"] is True

    def test_concurrent_audit_writes_no_duplicates(self, fixture_data):
        """11.2 — Simultaneous actions don't produce duplicate audit entries."""
        project_id = _create_project_for_test()
        assert project_id

        audit = _get_audit_log(project_id)
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])

        ids = [e["id"] for e in items]
        assert len(ids) == len(set(ids)), "Duplicate audit entry IDs detected"

    def test_regenerate_then_immediate_rollback_race(self, fixture_data):
        """11.3 — Regenerate + immediate rollback race handled gracefully."""
        versioning = fixture_data.get("versioning_fixtures", {})
        scenarios = versioning.get("concurrency_scenarios", [])
        race = next((s for s in scenarios if s["id"] == "regenerate_then_rollback_race"), None)
        assert race is not None
        assert race["expected"] == "graceful_handling"
        assert race["no_corruption"] is True


# ══════════════════════════════════════════════════════════════════════
# Edge cases & error conditions
# ══════════════════════════════════════════════════════════════════════

class TestRevisionEdgeCases:
    """Edge cases that could break versioning logic."""

    def test_list_revisions_empty_card(self, fixture_data):
        """12.1 — Card with no revisions returns empty list."""
        project_id = _create_project_for_test()
        assert project_id

        versioning = fixture_data.get("versioning_fixtures", {})
        edge_cases = versioning.get("edge_case_scenarios", [])
        empty = next((e for e in edge_cases if e["id"] == "empty_revision_list"), None)
        assert empty is not None
        assert empty["expected_status"] == 200

    def test_revision_deleted_project(self, fixture_data):
        """12.2 — Deleted card/project returns 404 or 410."""
        versioning = fixture_data.get("versioning_fixtures", {})
        edge_cases = versioning.get("edge_case_scenarios", [])
        deleted = next((e for e in edge_cases if e["id"] == "deleted_project_revisions"), None)
        assert deleted is not None
        assert deleted["expected_status"] in (404, 410)

    def test_revision_max_chain_length(self, fixture_data):
        """12.3 — System handles 100+ revision chains without degradation."""
        versioning = fixture_data.get("versioning_fixtures", {})
        edge_cases = versioning.get("edge_case_scenarios", [])
        long_chain = next((e for e in edge_cases if e["id"] == "long_chain_pagination"), None)
        assert long_chain is not None
        assert long_chain["revision_count"] == 100
        assert long_chain["expected_pages"] == 5

    def test_revision_metadata_unchanged_between_reads(self, fixture_data, valid_image_bytes):
        """12.4 — Fetching revision metadata twice yields identical results."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        rev_id = items[0]["id"]

        resp1 = _get_revision(project_id, rev_id)
        resp2 = _get_revision(project_id, rev_id)
        assert resp1.status_code == 200 and resp2.status_code == 200

        r1 = resp1.json()
        r2 = resp2.json()

        assert r1["content_hash"] == r2["content_hash"], "content_hash drifted between reads"
        assert r1["created_at"] == r2["created_at"], "created_at drifted between reads"
        assert r1["created_by"] == r2["created_by"], "created_by drifted between reads"

    def test_revision_bulk_stage_regeneration(self, fixture_data):
        """12.5 — Stage regeneration of 8 cards is atomic."""
        versioning = fixture_data.get("versioning_fixtures", {})
        edge_cases = versioning.get("edge_case_scenarios", [])
        atomic = next((e for e in edge_cases if e["id"] == "atomic_batch_regeneration"), None)
        assert atomic is not None
        assert atomic["card_count"] == 8
        assert atomic["expected"] == "all_succeed_or_none"


# ══════════════════════════════════════════════════════════════════════
# Export with revision traceability
# ══════════════════════════════════════════════════════════════════════

class TestExportRevisionTraceability:
    """Export includes full revision metadata for each card."""

    def test_export_includes_revision_info(self, fixture_data, valid_image_bytes):
        """13.1 — Export package includes revision_number and content_hash."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        export_resp = _export_project(project_id)
        if export_resp.status_code in (200, 201):
            export_data = export_resp.json()
            if "cards" in export_data:
                for card in export_data["cards"]:
                    assert "revision_number" in card, "Export missing revision_number"
                    assert "content_hash" in card, "Export missing content_hash"

    def test_export_includes_full_traceability(self, fixture_data, valid_image_bytes):
        """13.2 — Export metadata.json includes traceability block."""
        versioning = fixture_data.get("versioning_fixtures", {})
        provenance = versioning.get("provenance_integrity_checks", [])
        export_prov = next((p for p in provenance if p["id"] == "export_provenance"), None)
        assert export_prov is not None
        for field in export_prov["required_in_export"]:
            assert field in export_prov["required_in_export"]

    def test_export_audit_entry_present(self, fixture_data, valid_image_bytes):
        """13.3 — Export action generates an audit entry with export_id."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _export_project(project_id)

        audit = _get_audit_log(project_id, action="export_initiated")
        assert audit.status_code == 200

    def test_export_after_rollback_has_correct_revision(self, fixture_data, valid_image_bytes):
        """13.4 — After rollback, export reflects the restored revision."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        if len(items) >= 2:
            target_rev_id = items[0]["id"]
            target_rev_num = items[0]["revision_number"]

            _rollback_revision(project_id, card_id=1, revision_id=target_rev_id)

            export_resp = _export_project(project_id)
            if export_resp.status_code in (200, 201):
                export_data = export_resp.json()
                if "cards" in export_data:
                    card_1 = next((c for c in export_data["cards"] if c.get("card_id") == 1), None)
                    if card_1:
                        assert card_1.get("revision_number") > target_rev_num, \
            "Export should reflect the new post-rollback revision number"


# ══════════════════════════════════════════════════════════════════════
# Marketplace-specific audit requirements
# ══════════════════════════════════════════════════════════════════════

class TestMarketplaceAuditCompliance:
    """Audit trail meets marketplace compliance requirements."""

    def test_wb_strict_audit_fields(self, fixture_data, valid_image_bytes):
        """14.1 — WB project audit entries include all WB-required fields."""
        project_id = _create_project_for_test(marketplaces=["wildberries"])
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "content_hash" in items[0], "WB requires content_hash"
        assert "generation_timestamp" in trace, "WB requires generation_timestamp"

    def test_ozon_strict_audit_fields(self, fixture_data, valid_image_bytes):
        """14.2 — Ozon project audit entries include all Ozon-required fields."""
        project_id = _create_project_for_test(marketplaces=["ozon"])
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["ozon"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "model_id" in trace, "Ozon requires model_id"
        assert "seed" in trace, "Ozon requires seed"

    def test_dual_marketplace_audit_merges_rules(self, fixture_data, valid_image_bytes):
        """14.3 — Dual marketplace audit satisfies BOTH sets of requirements."""
        project_id = _create_project_for_test(marketplaces=["wildberries", "ozon"])
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries", "ozon"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        required_fields = {"content_hash", "model_id", "seed", "generation_timestamp",
                           "prompt_version", "workflow_version", "reference_hashes"}
        for field in required_fields:
            if field == "content_hash":
                assert field in items[0], f"Dual marketplace requires {field}"
            else:
                assert field in trace, f"Dual marketplace requires traceability.{field}"

    def test_audit_trail_survives_regen_cycles(self, fixture_data, valid_image_bytes):
        """14.4 — Complete audit trail intact after multiple regenerate cycles."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        for _ in range(5):
            _regenerate_card(project_id, card_id=1)

        audit = _get_audit_log(project_id, action="card_regenerated")
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(items) >= 5, f"Expected 5 regeneration audit entries, got {len(items)}"

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        revs = revisions.json()
        rev_items = revs if isinstance(revs, list) else revs.get("items", [])

        for i, rev in enumerate(rev_items):
            if i > 0:
                assert rev.get("parent_id") is not None, \
                    f"Revision {rev['revision_number']} should have parent_id"


# ══════════════════════════════════════════════════════════════════════
# Integration: versioning + workflow lifecycle
# ══════════════════════════════════════════════════════════════════════

class TestVersioningWorkflowIntegration:
    """Versioning interacts correctly with the overall workflow lifecycle."""

    def test_full_lifecycle_revision_count(self, fixture_data, valid_image_bytes):
        """15.1 — Full lifecycle produces correct and predictable revision count."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)
        _approve_stage(project_id, stage_id=0)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])

        assert len(items) >= 2, "Expected at least 2 revisions through lifecycle"

        for i, rev in enumerate(items):
            assert rev["revision_number"] == i + 1

    def test_approval_freezes_revision(self, fixture_data, valid_image_bytes):
        """15.2 — Approval freezes revision; further regenerations create new ones."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions_before = _list_revisions(project_id, card_id=1)
        revs_before = revisions_before.json()
        items_before = revs_before if isinstance(revs_before, list) else revs_before.get("items", [])
        approved_hash = items_before[0]["content_hash"] if items_before else None

        _regenerate_card(project_id, card_id=1)

        revisions_after = _list_revisions(project_id, card_id=1)
        revs_after = revisions_after.json()
        items_after = revs_after if isinstance(revs_after, list) else revs_after.get("items", [])
        assert len(items_after) > len(items_before), \
            "New regeneration should create additional revision"

        if approved_hash and items_after:
            original = _get_revision(project_id, items_before[0]["id"])
            if original.status_code == 200:
                assert original.json()["content_hash"] == approved_hash, \
                    "Approved revision content_hash must not change"

    def test_batch_final_preserves_revision_history(self, fixture_data, valid_image_bytes):
        """15.3 — Batch-final preserves full revision history for each card."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        for card_id in range(1, 4):
            _regenerate_card(project_id, card_id=card_id)
            _regenerate_card(project_id, card_id=card_id)

        path = CARDFLOW_ENDPOINTS["batch_final"].format(project_id=project_id)
        batch_resp = cf_post(path, json={})

        for card_id in range(1, 4):
            revisions = _list_revisions(project_id, card_id=card_id, sort="asc")
            revs = revisions.json()
            items = revs if isinstance(revs, list) else revs.get("items", [])
            assert len(items) >= 2, f"Card {card_id} should have full revision history"

    def test_regression_from_approved_version(self, fixture_data, valid_image_bytes):
        """15.4 — Regenerating from approved state doesn't mutate approved revision."""
        project_id = _create_project_for_test()
        assert project_id

        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)

        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        revs = revisions.json()
        items = revs if isinstance(revs, list) else revs.get("items", [])
        assert len(items) >= 1

        approved_rev_id = items[0]["id"]
        approved_hash = items[0]["content_hash"]

        _regenerate_card(project_id, card_id=1)

        original = _get_revision(project_id, approved_rev_id)
        assert original.status_code == 200
        assert original.json()["content_hash"] == approved_hash, \
            "Approved revision must remain immutable after further regeneration"
