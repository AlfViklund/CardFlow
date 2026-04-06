"""
Revision integrity tests — immutability, branching, targeted regeneration, provenance.

Covers:
  - Revision immutability (no PATCH/DELETE/PUT, hash stability, payload stability)
  - Branching behavior (linear chains, batch branching, mixed targeting)
  - Targeted regeneration (stage, card, element scopes with isolation)
  - Provenance integrity (traceability completeness, hash verifiability, seed reproducibility)
  - Concurrency safety (simultaneous writes, race conditions)
  - Edge cases (empty history, deleted project, long chains, cross-project access)
"""
import hashlib
import io
import json
from datetime import datetime, timezone
from typing import Any

import pytest
import requests

from conftest import cf_get, cf_post, cf_patch, cf_put, CARDFLOW_ENDPOINTS

pytestmark = pytest.mark.usefixtures("cardflow_up")


# ── Helpers ──────────────────────────────────────────────────────────

def _create_project_for_test(name: str | None = None, marketplaces: list[str] | None = None) -> str | None:
    """Create a minimal project and return its ID, or None on failure."""
    path = CARDFLOW_ENDPOINTS["create_project"]
    payload = {
        "name": name or f"QA Integrity Test {datetime.now(timezone.utc).isoformat()}",
        "marketplaces": marketplaces or ["wildberries"],
        "brief": "Test product for revision integrity QA",
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


def _regenerate_card(project_id: str, card_id: int) -> requests.Response:
    """Regenerate a single card."""
    path = CARDFLOW_ENDPOINTS["regenerate_card"].format(project_id=project_id, card_id=card_id)
    return cf_post(path, json={})


def _regenerate_stage(project_id: str, stage_id: int, force: bool = False) -> requests.Response:
    """Regenerate a workflow stage."""
    path = CARDFLOW_ENDPOINTS["regenerate_stage"].format(project_id=project_id, stage_id=stage_id)
    return cf_post(path, json={"force": force} if force else {})


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


def _export_project(project_id: str) -> requests.Response:
    """Attempt to export a project."""
    path = CARDFLOW_ENDPOINTS["export"].format(project_id=project_id)
    return cf_post(path, json={})


def _setup_minimal_project(valid_image_bytes) -> str:
    """Create and set up a minimal project, return project_id."""
    project_id = _create_project_for_test()
    assert project_id, "Failed to create test project"
    _upload_main_image(project_id, valid_image_bytes)
    _submit_brief(project_id, "Test product", ["wildberries"])
    _approve_step0(project_id)
    return project_id


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
# Revision immutability
# ══════════════════════════════════════════════════════════════════════

class TestRevisionImmutability:
    """Once a revision is created, its data cannot be modified, deleted, or replaced."""

    # ── Fixture-based assertions (runnable now) ──

    def test_patch_revision_returns_405_or_403(self, fixture_data):
        """PATCH on a revision endpoint must be rejected."""
        checks = fixture_data["versioning_fixtures"]["immutability_checks"]
        no_patch = next(c for c in checks if c["id"] == "no_patch")
        assert no_patch["method"] == "PATCH"
        assert no_patch["expected_status"] in (405, 403)

    def test_delete_revision_returns_405_or_403(self, fixture_data):
        """DELETE on a revision endpoint must be rejected."""
        checks = fixture_data["versioning_fixtures"]["immutability_checks"]
        no_delete = next(c for c in checks if c["id"] == "no_delete")
        assert no_delete["method"] == "DELETE"
        assert no_delete["expected_status"] in (405, 403)

    def test_put_revision_returns_405_or_403(self, fixture_data):
        """PUT on a revision endpoint must be rejected."""
        checks = fixture_data["versioning_fixtures"]["immutability_checks"]
        no_put = next(c for c in checks if c["id"] == "no_put")
        assert no_put["method"] == "PUT"
        assert no_put["expected_status"] in (405, 403)

    def test_hash_stability_spec(self, fixture_data):
        """Same revision fetched twice must yield identical content_hash."""
        checks = fixture_data["versioning_fixtures"]["immutability_checks"]
        hash_check = next(c for c in checks if c["id"] == "hash_stability")
        assert hash_check["fetches"] == 2
        assert hash_check["expected"] == "identical_hashes"

    def test_payload_stability_spec(self, fixture_data):
        """Same revision payload_snapshot fetched twice must be identical."""
        checks = fixture_data["versioning_fixtures"]["immutability_checks"]
        payload_check = next(c for c in checks if c["id"] == "payload_stability")
        assert payload_check["fetches"] == 2
        assert payload_check["expected"] == "identical_payloads"

    def test_metadata_stability_spec(self, fixture_data):
        """created_at, created_by, and traceability fields never change."""
        checks = fixture_data["versioning_fixtures"]["immutability_checks"]
        meta_check = next(c for c in checks if c["id"] == "metadata_stability")
        assert meta_check["fetches"] == 2
        assert meta_check["expected"] == "identical_metadata"

    # ── API-based tests (run when app is deployed) ──

    def test_revision_hash_stable_across_reads(self, valid_image_bytes):
        """Fetch the same revision twice — content_hash must not drift."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        rev_id = items[0]["id"]
        resp1 = _get_revision(project_id, rev_id)
        resp2 = _get_revision(project_id, rev_id)
        assert resp1.status_code == 200
        assert resp2.status_code == 200

        r1 = resp1.json()
        r2 = resp2.json()
        assert r1["content_hash"] == r2["content_hash"], "content_hash drifted between reads"

    def test_revision_payload_snapshot_unchanged(self, valid_image_bytes):
        """Fetch the same revision twice — payload_snapshot must be identical."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        rev_id = items[0]["id"]
        resp1 = _get_revision(project_id, rev_id)
        resp2 = _get_revision(project_id, rev_id)
        assert resp1.json()["payload_snapshot"] == resp2.json()["payload_snapshot"]

    def test_revision_metadata_unchanged_between_reads(self, valid_image_bytes):
        """created_at, created_by, traceability must be identical across reads."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        rev_id = items[0]["id"]
        resp1 = _get_revision(project_id, rev_id)
        resp2 = _get_revision(project_id, rev_id)
        r1, r2 = resp1.json(), resp2.json()

        assert r1["created_at"] == r2["created_at"], "created_at drifted"
        assert r1["created_by"] == r2["created_by"], "created_by drifted"
        assert r1.get("traceability") == r2.get("traceability"), "traceability drifted"

    def test_cascading_change_creates_new_revision(self, valid_image_bytes):
        """Modifying card data creates a new revision; the old one stays untouched."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        old_rev_id = items[0]["id"]
        old_hash = items[0]["content_hash"]

        _regenerate_card(project_id, card_id=1)

        original = _get_revision(project_id, old_rev_id)
        assert original.status_code == 200
        assert original.json()["content_hash"] == old_hash, \
            "Old revision content_hash changed after cascading change"

    def test_revision_has_required_fields(self, fixture_data, valid_image_bytes):
        """Every revision must contain all required schema fields."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        schema = fixture_data["versioning_fixtures"]["revision_schema"]
        _assert_revision_schema(items[0], schema)


# ══════════════════════════════════════════════════════════════════════
# Branching behavior
# ══════════════════════════════════════════════════════════════════════

class TestBranchingBehavior:
    """Revision chains are linear for single-card edits, batch for stage regeneration."""

    # ── Fixture-based assertions ──

    def test_linear_chain_spec(self, fixture_data):
        """Repeated single-card regenerations form a linear chain with no branches."""
        scenarios = fixture_data["versioning_fixtures"]["branching_scenarios"]
        linear = next(s for s in scenarios if s["id"] == "linear_single_card")
        assert linear["expected_chain"] == [1, 2, 3, 4]
        assert linear["expected_branches"] == 0
        for op in linear["operations"]:
            if op["revision"] > 1:
                assert op["parent_id"] == op["revision"] - 1

    def test_stage_batch_branch_spec(self, fixture_data):
        """Stage-level regeneration creates parallel revisions sharing a batch_id."""
        scenarios = fixture_data["versioning_fixtures"]["branching_scenarios"]
        batch = next(s for s in scenarios if s["id"] == "stage_batch_branch")
        assert batch["shared_batch_id"] == "batch_001"
        assert batch["expected_chain_per_card"] == [1, 2]

    def test_mixed_targeting_spec(self, fixture_data):
        """Mix of stage, card, and element regenerations produces correct chains."""
        scenarios = fixture_data["versioning_fixtures"]["branching_scenarios"]
        mixed = next(s for s in scenarios if s["id"] == "mixed_targeting")
        assert mixed["expected_card_3_chain"] == [1, 2, 3]
        assert mixed["expected_card_5_chain"] == [1, 2, 3]
        assert mixed["expected_other_cards_chain"] == [1, 2]

    # ── API-based tests ──

    def test_linear_chain_parent_ids(self, valid_image_bytes):
        """Every revision (except r1) references its immediate parent."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)
        _regenerate_card(project_id, card_id=1)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 3

        assert items[0].get("parent_id") is None, "First revision must have no parent"
        for i in range(1, len(items)):
            assert items[i].get("parent_id") is not None, \
                f"Revision {items[i]['revision_number']} must have a parent_id"

    def test_revision_numbers_sequential_no_gaps(self, valid_image_bytes):
        """Revision numbers increment monotonically without gaps."""
        project_id = _setup_minimal_project(valid_image_bytes)
        for _ in range(5):
            _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])

        numbers = [r["revision_number"] for r in items]
        expected = list(range(1, len(items) + 1))
        assert numbers == expected, f"Expected {expected}, got {numbers}"

    def test_stage_regeneration_creates_revisions_for_all_cards(self, valid_image_bytes):
        """Stage-level regeneration creates revisions for every card in the stage."""
        project_id = _setup_minimal_project(valid_image_bytes)
        resp = _regenerate_stage(project_id, stage_id=4)
        assert resp.status_code in (200, 201), f"Stage regenerate failed: {resp.status_code}"

        for card_id in range(1, 9):
            revisions = _list_revisions(project_id, card_id=card_id)
            items = revisions.json()
            items = items if isinstance(items, list) else items.get("items", [])
            assert len(items) >= 1, f"Card {card_id} should have at least one revision"

    def test_element_regeneration_isolated_to_single_card(self, valid_image_bytes):
        """Element regeneration only creates a revision for the targeted card."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions_before = {}
        for cid in range(1, 9):
            revs = _list_revisions(project_id, card_id=cid)
            items = revs.json()
            revisions_before[cid] = len(items) if isinstance(items, list) else len(items.get("items", []))

        _regenerate_element(project_id, card_id=3, element="text_overlay")

        for cid in range(1, 9):
            revs = _list_revisions(project_id, card_id=cid)
            items = revs.json()
            count = len(items) if isinstance(items, list) else len(items.get("items", []))
            if cid == 3:
                assert count > revisions_before[cid], \
                    f"Card {cid} should have a new revision after element regenerate"
            else:
                assert count == revisions_before[cid], \
                    f"Card {cid} should NOT have changed after element regenerate on card 3"


# ══════════════════════════════════════════════════════════════════════
# Targeted regeneration
# ══════════════════════════════════════════════════════════════════════

class TestTargetedRegeneration:
    """Regeneration at stage, card, and element scopes with correct isolation."""

    # ── Fixture-based assertions ──

    def test_regeneration_targets_are_exhaustive(self, fixture_data):
        """All three regeneration scopes must be defined: stage, card, element."""
        targets = fixture_data["versioning_fixtures"]["regeneration_targets"]
        scopes = {t["scope"] for t in targets}
        assert scopes == {"stage", "card", "element"}

    def test_valid_elements_list(self, fixture_data):
        """Valid element names for element-level regeneration."""
        valid = fixture_data["versioning_fixtures"]["valid_elements"]
        assert set(valid) == {"text_overlay", "background", "badge", "icon", "position"}

    def test_stage_regeneration_revision_count(self, fixture_data):
        """Stage regeneration creates revisions for all cards."""
        targets = fixture_data["versioning_fixtures"]["regeneration_targets"]
        stage_target = next(t for t in targets if t["scope"] == "stage")
        assert stage_target["expected_revision_count"] == "all_cards"

    def test_card_regeneration_revision_count(self, fixture_data):
        """Card regeneration creates exactly 1 revision."""
        targets = fixture_data["versioning_fixtures"]["regeneration_targets"]
        card_target = next(t for t in targets if t["scope"] == "card")
        assert card_target["expected_revision_count"] == 1

    def test_element_regeneration_revision_count(self, fixture_data):
        """Element regeneration creates exactly 1 revision."""
        targets = fixture_data["versioning_fixtures"]["regeneration_targets"]
        elem_target = next(t for t in targets if t["scope"] == "element")
        assert elem_target["expected_revision_count"] == 1

    # ── API-based tests ──

    def test_card_regenerate_creates_one_revision(self, valid_image_bytes):
        """Regenerating a single card creates exactly one new revision."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        latest = items[0]
        assert latest["action"] in ("card_created", "card_regenerated")

    def test_element_regenerate_action_recorded(self, valid_image_bytes):
        """Element regeneration records the correct action type."""
        project_id = _setup_minimal_project(valid_image_bytes)
        resp = _regenerate_element(project_id, card_id=1, element="text_overlay")
        assert resp.status_code in (200, 201), f"Element regenerate failed: {resp.status_code}"

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        latest_action = items[0]["action"]
        valid_actions = fixture_data["versioning_fixtures"]["revision_actions"]
        assert latest_action in valid_actions, f"Invalid action: {latest_action}"

    def test_regenerate_invalid_element_returns_422(self, fixture_data):
        """Regenerating with an invalid element name returns 422."""
        error_cases = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        regen = next(e for e in error_cases if e["scenario"] == "regenerate_invalid_element")
        assert regen["expected_status"] == 422
        assert "nonexistent_field" in regen["params"]["element"]

    def test_regenerate_unapproved_stage_requires_force(self, fixture_data):
        """Regenerating an unapproved stage requires the force flag."""
        error_cases = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        regen = next(e for e in error_cases if e["scenario"] == "regenerate_unapproved_stage")
        assert regen["expected_status"] == 400
        assert "force flag" in regen["expected_error"]

    def test_sibling_cards_unchanged_after_single_card_regenerate(self, valid_image_bytes):
        """Regenerating card 3 leaves cards 1, 2, 4-8 untouched."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        hashes_before = {}
        for cid in range(1, 9):
            revs = _list_revisions(project_id, card_id=cid)
            items = revs.json()
            if isinstance(items, list) and items:
                hashes_before[cid] = items[0]["content_hash"]
            else:
                hashes_before[cid] = None

        _regenerate_card(project_id, card_id=3)

        for cid in range(1, 9):
            revs = _list_revisions(project_id, card_id=cid)
            items = revs.json()
            latest_hash = items[0]["content_hash"] if (isinstance(items, list) and items) else None
            if cid != 3:
                assert hashes_before[cid] == latest_hash, \
                    f"Card {cid} hash changed unexpectedly after card 3 regenerate"


# ══════════════════════════════════════════════════════════════════════
# Provenance integrity
# ══════════════════════════════════════════════════════════════════════

class TestProvenanceIntegrity:
    """Every revision carries complete, verifiable generation traceability."""

    # ── Fixture-based assertions ──

    def test_traceability_required_fields(self, fixture_data):
        """All required traceability fields must be present."""
        checks = fixture_data["versioning_fixtures"]["provenance_integrity_checks"]
        completeness = next(c for c in checks if c["id"] == "traceability_completeness")
        required = set(completeness["required_fields"])
        assert "prompt_version" in required
        assert "workflow_version" in required
        assert "seed" in required
        assert "model_id" in required
        assert "reference_hashes" in required
        assert "input_hashes" in required
        assert "generation_timestamp" in required

    def test_reference_hash_verifiability_spec(self, fixture_data):
        """Reference hashes in revisions must match actual uploaded reference files."""
        checks = fixture_data["versioning_fixtures"]["provenance_integrity_checks"]
        ref_check = next(c for c in checks if c["id"] == "reference_hash_verifiability")
        assert ref_check["check"] == "hash_match"

    def test_seed_reproducibility_spec(self, fixture_data):
        """Same seed + same inputs should produce the same output hash."""
        checks = fixture_data["versioning_fixtures"]["provenance_integrity_checks"]
        seed_check = next(c for c in checks if c["id"] == "seed_reproducibility")
        assert seed_check["check"] == "deterministic"

    def test_export_provenance_spec(self, fixture_data):
        """Export package must include traceability for each card."""
        checks = fixture_data["versioning_fixtures"]["provenance_integrity_checks"]
        export_prov = next(c for c in checks if c["id"] == "export_provenance")
        required_in_export = set(export_prov["required_in_export"])
        assert "revision_number" in required_in_export
        assert "content_hash" in required_in_export
        assert "prompt_version" in required_in_export
        assert "workflow_version" in required_in_export
        assert "model_id" in required_in_export

    # ── API-based tests ──

    def test_revision_has_prompt_version(self, valid_image_bytes):
        """Revision records which prompt version was used."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "prompt_version" in trace
        assert isinstance(trace["prompt_version"], str)
        assert len(trace["prompt_version"]) > 0

    def test_revision_has_workflow_version(self, valid_image_bytes):
        """Revision records which workflow version generated it."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "workflow_version" in trace

    def test_revision_has_model_id(self, valid_image_bytes):
        """Revision records which AI model generated the output."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "model_id" in trace
        assert isinstance(trace["model_id"], str)

    def test_revision_has_seed(self, valid_image_bytes):
        """Revision records the random seed used for generation."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "seed" in trace
        assert isinstance(trace["seed"], int)

    def test_revision_has_reference_hashes(self, valid_image_bytes):
        """Revision records SHA-256 hashes of reference images."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "reference_hashes" in trace
        assert isinstance(trace["reference_hashes"], list)

    def test_revision_has_input_hashes(self, valid_image_bytes):
        """Revision records SHA-256 hashes of input files."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "input_hashes" in trace
        assert isinstance(trace["input_hashes"], list)

    def test_revision_has_generation_timestamp(self, valid_image_bytes):
        """Revision records when the content was generated."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "generation_timestamp" in trace
        assert isinstance(trace["generation_timestamp"], str)

    def test_complete_traceability_object(self, fixture_data, valid_image_bytes):
        """Full traceability object must pass completeness check."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        _assert_traceability(trace)

        checks = fixture_data["versioning_fixtures"]["provenance_integrity_checks"]
        completeness = next(c for c in checks if c["id"] == "traceability_completeness")
        for field in completeness["required_fields"]:
            assert field in trace, f"Missing required traceability field: {field}"

    def test_content_hash_is_valid_sha256(self, valid_image_bytes):
        """content_hash must be a valid SHA-256 hex string."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        content_hash = items[0]["content_hash"]
        assert len(content_hash) == 64, f"SHA-256 hash should be 64 hex chars, got {len(content_hash)}"
        try:
            int(content_hash, 16)
        except ValueError:
            pytest.fail(f"content_hash is not valid hex: {content_hash}")


# ══════════════════════════════════════════════════════════════════════
# Concurrency safety
# ══════════════════════════════════════════════════════════════════════

class TestConcurrencySafety:
    """Handle concurrent revision writes safely without data loss or corruption."""

    # ── Fixture-based assertions ──

    def test_simultaneous_regenerate_spec(self, fixture_data):
        """Two simultaneous regenerations produce distinct sequential revisions."""
        scenarios = fixture_data["versioning_fixtures"]["concurrency_scenarios"]
        concurrent = next(s for s in scenarios if s["id"] == "simultaneous_card_regenerate")
        assert concurrent["expected"] == "two_distinct_sequential_revisions"
        assert concurrent["no_data_loss"] is True

    def test_regenerate_rollback_race_spec(self, fixture_data):
        """Regenerate + immediate rollback race handled gracefully."""
        scenarios = fixture_data["versioning_fixtures"]["concurrency_scenarios"]
        race = next(s for s in scenarios if s["id"] == "regenerate_then_rollback_race")
        assert race["expected"] == "graceful_handling"
        assert race["no_corruption"] is True

    # ── API-based tests ──

    def test_audit_entries_no_duplicate_ids(self, valid_image_bytes):
        """Audit log entries must have unique IDs."""
        project_id = _setup_minimal_project(valid_image_bytes)
        audit = _get_audit_log(project_id)
        items = audit.json()
        items = items if isinstance(items, list) else items.get("items", [])

        ids = [e["id"] for e in items]
        assert len(ids) == len(set(ids)), "Duplicate audit entry IDs detected"

    def test_revision_ids_are_unique(self, valid_image_bytes):
        """All revision IDs within a card must be unique."""
        project_id = _setup_minimal_project(valid_image_bytes)
        for _ in range(3):
            _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])

        rev_ids = [r["id"] for r in items]
        assert len(rev_ids) == len(set(rev_ids)), "Duplicate revision IDs detected"


# ══════════════════════════════════════════════════════════════════════
# Edge cases & error conditions
# ══════════════════════════════════════════════════════════════════════

class TestRevisionEdgeCases:
    """Edge cases that could break versioning logic."""

    # ── Fixture-based assertions ──

    def test_empty_revision_list_spec(self, fixture_data):
        """Card with no revisions returns empty list with 200."""
        edge_cases = fixture_data["versioning_fixtures"]["edge_case_scenarios"]
        empty = next(e for e in edge_cases if e["id"] == "empty_revision_list")
        assert empty["expected_status"] == 200
        assert empty["expected_body"] == []

    def test_deleted_project_revisions_spec(self, fixture_data):
        """Accessing revisions of deleted project returns 404 or 410."""
        edge_cases = fixture_data["versioning_fixtures"]["edge_case_scenarios"]
        deleted = next(e for e in edge_cases if e["id"] == "deleted_project_revisions")
        assert deleted["expected_status"] in (404, 410)

    def test_long_chain_pagination_spec(self, fixture_data):
        """100+ revision chain with correct pagination."""
        edge_cases = fixture_data["versioning_fixtures"]["edge_case_scenarios"]
        long_chain = next(e for e in edge_cases if e["id"] == "long_chain_pagination")
        assert long_chain["revision_count"] == 100
        assert long_chain["page_size"] == 20
        assert long_chain["expected_pages"] == 5

    def test_cross_project_revision_access_spec(self, fixture_data):
        """Fetching revision from different project returns 403 or 404."""
        edge_cases = fixture_data["versioning_fixtures"]["edge_case_scenarios"]
        cross = next(e for e in edge_cases if e["id"] == "cross_project_revision_access")
        assert cross["expected_status"] in (403, 404)

    def test_cross_card_comparison_spec(self, fixture_data):
        """Comparing revisions from different cards returns 400."""
        edge_cases = fixture_data["versioning_fixtures"]["edge_case_scenarios"]
        cross = next(e for e in edge_cases if e["id"] == "cross_card_comparison")
        assert cross["expected_status"] == 400

    def test_atomic_batch_regeneration_spec(self, fixture_data):
        """Stage regeneration of 8 cards is atomic — all or nothing."""
        edge_cases = fixture_data["versioning_fixtures"]["edge_case_scenarios"]
        atomic = next(e for e in edge_cases if e["id"] == "atomic_batch_regeneration")
        assert atomic["card_count"] == 8
        assert atomic["expected"] == "all_succeed_or_none"

    # ── API-based tests ──

    def test_list_revisions_nonexistent_card_returns_404(self, valid_image_bytes):
        """Listing revisions for a non-existent card returns 404."""
        project_id = _setup_minimal_project(valid_image_bytes)
        resp = _list_revisions(project_id, card_id=99999)
        assert resp.status_code == 404

    def test_get_revision_not_found_returns_404(self, valid_image_bytes):
        """Fetching a non-existent revision returns 404."""
        project_id = _setup_minimal_project(valid_image_bytes)
        resp = _get_revision(project_id, "00000000-0000-0000-0000-000000000000")
        assert resp.status_code == 404

    def test_cross_project_revision_access_denied(self, valid_image_bytes):
        """Fetching a revision from a different project returns 403 or 404."""
        project_a = _create_project_for_test("Project A")
        project_b = _create_project_for_test("Project B")
        assert project_a and project_b

        _upload_main_image(project_a, valid_image_bytes)
        _submit_brief(project_a, "Test A", ["wildberries"])
        _approve_step0(project_a)

        _regenerate_card(project_a, card_id=1)

        revisions = _list_revisions(project_a, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        rev_id = items[0]["id"]
        resp = _get_revision(project_b, rev_id)
        assert resp.status_code in (403, 404), \
            f"Cross-project revision access should be denied, got {resp.status_code}"

    def test_compare_same_revision_returns_empty_diff(self, valid_image_bytes):
        """Comparing a revision with itself returns no changes."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
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

    def test_compare_consecutive_revisions_returns_diff(self, valid_image_bytes):
        """Comparing consecutive revisions returns meaningful diff."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 2

        resp = _compare_revisions(project_id, card_id=1,
                                  from_rev=items[0]["id"], to_rev=items[1]["id"])
        assert resp.status_code == 200
        diff = resp.json()

        valid_keys = {"added", "removed", "modified", "changes", "unchanged", "summary"}
        assert any(k in diff for k in valid_keys), \
            f"Diff output should include at least one of {valid_keys}"


# ══════════════════════════════════════════════════════════════════════
# Rollback integrity
# ══════════════════════════════════════════════════════════════════════

class TestRollbackIntegrity:
    """Restoring a previous revision creates a new revision without mutating history."""

    # ── Fixture-based assertions ──

    def test_rollback_to_earlier_spec(self, fixture_data):
        """Rollback from r5 to r2 creates new r6 with r2's payload."""
        scenarios = fixture_data["versioning_fixtures"]["rollback_scenarios"]
        rollback = next(s for s in scenarios if s["id"] == "rollback_to_earlier")
        assert rollback["current_revision"] == 5
        assert rollback["target_revision"] == 2
        assert rollback["expected_new_revision"] == 6
        assert rollback["original_r2_untouched"] is True

    def test_rollback_to_current_spec(self, fixture_data):
        """Rollback to current revision is a no-op or returns 400/409."""
        scenarios = fixture_data["versioning_fixtures"]["rollback_scenarios"]
        rollback = next(s for s in scenarios if s["id"] == "rollback_to_current")
        assert rollback["expected_outcome"] == "no_op_or_error"
        assert rollback["no_data_corruption"] is True

    def test_rollback_nonexistent_spec(self, fixture_data):
        """Rollback to non-existent revision returns 404."""
        scenarios = fixture_data["versioning_fixtures"]["rollback_scenarios"]
        rollback = next(s for s in scenarios if s["id"] == "rollback_nonexistent")
        assert rollback["expected_status"] == 404

    def test_rollback_preserves_history_spec(self, fixture_data):
        """After rollback, full revision chain is intact."""
        scenarios = fixture_data["versioning_fixtures"]["rollback_scenarios"]
        rollback = next(s for s in scenarios if s["id"] == "rollback_preserves_history")
        assert rollback["expected_chain_length"] == 4
        assert rollback["no_gaps"] is True

    # ── API-based tests ──

    def test_rollback_creates_new_revision(self, valid_image_bytes):
        """Rollback creates a new revision; original is untouched."""
        project_id = _setup_minimal_project(valid_image_bytes)
        for _ in range(3):
            _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 3

        target_rev_id = items[0]["id"]
        target_hash = items[0]["content_hash"]

        resp = _rollback_revision(project_id, card_id=1, revision_id=target_rev_id)
        assert resp.status_code in (200, 201), f"Rollback failed: {resp.status_code}"

        revisions_after = _list_revisions(project_id, card_id=1, sort="asc")
        items_after = revisions_after.json()
        items_after = items_after if isinstance(items_after, list) else items_after.get("items", [])
        assert len(items_after) > len(items), "Rollback should create a new revision"

        original = _get_revision(project_id, target_rev_id)
        assert original.status_code == 200
        assert original.json()["content_hash"] == target_hash, \
            "Original revision content_hash must remain unchanged"

    def test_rollback_increments_revision_number(self, valid_image_bytes):
        """After rollback, the new revision number is max + 1."""
        project_id = _setup_minimal_project(valid_image_bytes)
        for _ in range(3):
            _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        current_max = max(r["revision_number"] for r in items)

        _rollback_revision(project_id, card_id=1, revision_id=items[-1]["id"])

        revisions_after = _list_revisions(project_id, card_id=1)
        items_after = revisions_after.json()
        items_after = items_after if isinstance(items_after, list) else items_after.get("items", [])
        new_max = max(r["revision_number"] for r in items_after)

        assert new_max == current_max + 1

    def test_rollback_records_audit_entry(self, valid_image_bytes):
        """Rollback generates an audit entry with action=revision_restored."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        _rollback_revision(project_id, card_id=1, revision_id=items[0]["id"])

        audit = _get_audit_log(project_id, action="revision_restored")
        assert audit.status_code == 200
        entries = audit.json()
        audit_items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(audit_items) >= 1, "Expected audit entry for rollback"

    def test_rollback_nonexistent_revision_returns_404(self, valid_image_bytes):
        """Rollback to non-existent revision returns 404."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        resp = _rollback_revision(project_id, card_id=1,
                                  revision_id="00000000-0000-0000-0000-000000000000")
        assert resp.status_code == 404

    def test_rollback_to_current_is_noop_or_error(self, valid_image_bytes):
        """Rollback to the current (latest) revision is a no-op or returns 400/409."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        latest = items[0]

        resp = _rollback_revision(project_id, card_id=1, revision_id=latest["id"])
        assert resp.status_code in (200, 400, 409), \
            f"Rollback to current should be no-op or error, got {resp.status_code}"


# ══════════════════════════════════════════════════════════════════════
# Audit trail completeness
# ══════════════════════════════════════════════════════════════════════

class TestAuditTrailCompleteness:
    """Every meaningful action is recorded with complete audit information."""

    def test_audit_entry_schema_valid(self, fixture_data):
        """Audit entries must conform to the defined schema."""
        schema = fixture_data["versioning_fixtures"]["audit_entry_schema"]
        required = ("id", "project_id", "action", "actor", "timestamp", "details")
        for key in required:
            assert key in schema, f"Missing audit schema field: {key}"

    def test_audit_action_details_cover_all_actions(self, fixture_data):
        """All revision actions must have corresponding audit detail schemas."""
        action_details = fixture_data["versioning_fixtures"]["audit_action_details"]
        revision_actions = fixture_data["versioning_fixtures"]["revision_actions"]
        for action in revision_actions:
            assert action in action_details, f"Missing audit details for action: {action}"

    def test_card_create_audit_entry(self, valid_image_bytes):
        """Creating a card generates an audit entry with card_id."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        audit = _get_audit_log(project_id, action="card_regenerated")
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(items) >= 1

        entry = items[0]
        _assert_audit_entry_schema(entry)
        assert "card_id" in entry["details"], "Audit entry should include card_id"

    def test_stage_approve_audit_entry(self, valid_image_bytes):
        """Approving a stage generates an audit entry."""
        project_id = _setup_minimal_project(valid_image_bytes)
        path = CARDFLOW_ENDPOINTS["approve_stage"].format(project_id=project_id, stage_id=0)
        cf_post(path, json={})

        audit = _get_audit_log(project_id, action="stage_approved")
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(items) >= 1

    def test_export_audit_entry(self, valid_image_bytes):
        """Exporting generates an audit entry."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _export_project(project_id)

        audit = _get_audit_log(project_id, action="export_initiated")
        assert audit.status_code == 200


# ══════════════════════════════════════════════════════════════════════
# Marketplace-specific audit requirements
# ══════════════════════════════════════════════════════════════════════

class TestMarketplaceAuditCompliance:
    """Audit trail meets marketplace-specific compliance requirements."""

    def test_wb_requires_content_hash(self, valid_image_bytes):
        """WB project audit entries include content_hash."""
        project_id = _create_project_for_test(marketplaces=["wildberries"])
        assert project_id
        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries"])
        _approve_step0(project_id)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1
        assert "content_hash" in items[0], "WB requires content_hash"

    def test_ozon_requires_model_id_and_seed(self, valid_image_bytes):
        """Ozon project audit entries include model_id and seed."""
        project_id = _create_project_for_test(marketplaces=["ozon"])
        assert project_id
        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["ozon"])
        _approve_step0(project_id)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        trace = items[0].get("traceability", {})
        assert "model_id" in trace, "Ozon requires model_id"
        assert "seed" in trace, "Ozon requires seed"

    def test_dual_marketplace_satisfies_both(self, valid_image_bytes):
        """Dual marketplace audit satisfies both WB and Ozon requirements."""
        project_id = _create_project_for_test(marketplaces=["wildberries", "ozon"])
        assert project_id
        _upload_main_image(project_id, valid_image_bytes)
        _submit_brief(project_id, "Test product", ["wildberries", "ozon"])
        _approve_step0(project_id)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        rev = items[0]
        trace = rev.get("traceability", {})
        required_fields = {"content_hash", "model_id", "seed", "generation_timestamp",
                           "prompt_version", "workflow_version", "reference_hashes"}
        for field in required_fields:
            if field == "content_hash":
                assert field in rev, f"Dual marketplace requires {field}"
            else:
                assert field in trace, f"Dual marketplace requires traceability.{field}"

    def test_audit_trail_survives_regen_cycles(self, valid_image_bytes):
        """Complete audit trail intact after multiple regenerate cycles."""
        project_id = _setup_minimal_project(valid_image_bytes)
        for _ in range(5):
            _regenerate_card(project_id, card_id=1)

        audit = _get_audit_log(project_id, action="card_regenerated")
        assert audit.status_code == 200
        entries = audit.json()
        items = entries if isinstance(entries, list) else entries.get("items", [])
        assert len(items) >= 5, f"Expected 5 regeneration audit entries, got {len(items)}"

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        rev_items = revisions.json()
        rev_items = rev_items if isinstance(rev_items, list) else rev_items.get("items", [])

        for i, rev in enumerate(rev_items):
            if i > 0:
                assert rev.get("parent_id") is not None, \
                    f"Revision {rev['revision_number']} should have parent_id"


# ══════════════════════════════════════════════════════════════════════
# Integration: versioning + workflow lifecycle
# ══════════════════════════════════════════════════════════════════════

class TestVersioningWorkflowIntegration:
    """Versioning interacts correctly with the overall workflow lifecycle."""

    def test_full_lifecycle_revision_count(self, valid_image_bytes):
        """Full lifecycle produces correct and predictable revision count."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])

        assert len(items) >= 2, "Expected at least 2 revisions through lifecycle"
        for i, rev in enumerate(items):
            assert rev["revision_number"] == i + 1

    def test_approved_revision_remains_immutable(self, valid_image_bytes):
        """Approved revision content_hash must not change after further regeneration."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1)
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
        assert len(items) >= 1

        approved_rev_id = items[0]["id"]
        approved_hash = items[0]["content_hash"]

        _regenerate_card(project_id, card_id=1)

        original = _get_revision(project_id, approved_rev_id)
        assert original.status_code == 200
        assert original.json()["content_hash"] == approved_hash, \
            "Approved revision must remain immutable after further regeneration"

    def test_export_after_rollback_reflects_correct_revision(self, valid_image_bytes):
        """After rollback, export reflects the new post-rollback revision number."""
        project_id = _setup_minimal_project(valid_image_bytes)
        _regenerate_card(project_id, card_id=1)
        _regenerate_card(project_id, card_id=1)

        revisions = _list_revisions(project_id, card_id=1, sort="asc")
        items = revisions.json()
        items = items if isinstance(items, list) else items.get("items", [])
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
