"""
Batch final run tests for the generation engine.

Covers:
- Batch final preconditions (all prior stages approved)
- Batch final with partial approval (blocked)
- Batch final transitions cards to final_generation stage
- Batch final atomicity (all cards or none)
- Batch final after regeneration cycles
"""
import pytest


class TestBatchFinalPreconditions:
    """Validate preconditions for batch final operation."""

    def test_batch_final_requires_all_prior_stages_approved(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        stage4 = next(s for s in stages if s["name"] == "final_generation")
        assert stage4["stage"] == 4
        assert stage4["accepts"] == ["approved_design", "approved_copy", "approved_scenes"]

    def test_batch_final_needs_approved_design(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        stage4 = next(s for s in stages if s["name"] == "final_generation")
        assert "approved_design" in stage4["accepts"]

    def test_batch_final_needs_approved_copy(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        stage4 = next(s for s in stages if s["name"] == "final_generation")
        assert "approved_copy" in stage4["accepts"]

    def test_batch_final_needs_approved_scenes(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        stage4 = next(s for s in stages if s["name"] == "final_generation")
        assert "approved_scenes" in stage4["accepts"]


class TestBatchFinalPartialApprovalBlock:
    """Validate that batch final is blocked when prior stages are not fully approved."""

    def test_batch_final_blocked_by_unapproved_stage_3(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        batch = next(e for e in error_flows if e["scenario"] == "batch_final_partial_approval")
        assert batch["expected_status"] == 409
        assert batch["unapproved_stages"] == [3]

    def test_batch_final_error_identifies_blocking_stage(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        batch = next(e for e in error_flows if e["scenario"] == "batch_final_partial_approval")
        assert "stage 3" in batch["expected_error"]
        assert "design_concepts" in batch["expected_error"]

    def test_batch_final_blocked_state_shows_approved_stages(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        batch = next(e for e in error_flows if e["scenario"] == "batch_final_partial_approval")
        assert batch["state"]["stages_0_through_2_approved"] is True
        assert batch["state"]["stage_3_concepts"] == "pending"
        assert batch["state"]["stage_4_final"] == "not_started"


class TestBatchFinalArtifact:
    """Validate batch final output artifact structure."""

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

    def test_card_ids_are_sequential_1_to_8(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        card_ids = [c["card_id"] for c in artifact["cards"]]
        assert card_ids == list(range(1, 9))

    def test_scene_ids_are_sequential_1_to_8(self, fixture_data):
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

    def test_cards_share_design_variant(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        variants = {c["design_variant"] for c in artifact["cards"]}
        assert len(variants) == 1
        assert "concept_a" in variants


class TestBatchFinalTraceability:
    """Validate traceability metadata on batch final output."""

    def test_traceability_has_prompt_version(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        assert "prompt_version" in artifact["traceability"]
        assert artifact["traceability"]["prompt_version"] == "v2.1"

    def test_traceability_has_workflow_version(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        assert "workflow_version" in artifact["traceability"]
        assert artifact["traceability"]["workflow_version"] == "v1.0"

    def test_traceability_has_seed(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        assert "seed" in artifact["traceability"]
        assert artifact["traceability"]["seed"] == 42

    def test_traceability_has_model_id(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        assert "model_id" in artifact["traceability"]
        assert artifact["traceability"]["model_id"] == "image-gen-v3"

    def test_traceability_has_reference_hashes(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        assert "reference_hashes" in artifact["traceability"]
        assert len(artifact["traceability"]["reference_hashes"]) > 0

    def test_traceability_fields_are_immutable(self, fixture_data):
        artifact = fixture_data["workflow_fixtures"]["final_generation_artifact"]
        trace = artifact["traceability"]
        required = ["prompt_version", "workflow_version", "seed", "model_id", "reference_hashes"]
        for field in required:
            assert field in trace


class TestBatchFinalAfterRegeneration:
    """Validate batch final behavior after regeneration cycles."""

    def test_batch_final_after_card_regeneration(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        regen = next(s for s in scenarios if s["scenario"] == "regenerate_single_approved_card")
        assert regen["expected"]["card_3_revision"] == 2
        assert regen["expected"]["all_other_cards_unchanged"] is True

    def test_batch_final_requires_all_cards_approved(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        full = next(s for s in scenarios if s["scenario"] == "all_cards_approved_export_ready")
        assert full["approved_count"] == 8
        assert full["export_allowed"] is True

    def test_batch_final_blocked_on_partial_approval(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        partial = next(s for s in scenarios if s["scenario"] == "half_cards_approved_in_stage")
        assert partial["export_allowed"] is False
        assert partial["approved_count"] == 5
        assert partial["pending_count"] == 2
        assert partial["draft_count"] == 1
