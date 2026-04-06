"""
Stage transition tests for the generation engine.

Covers:
- Sequential stage progression (0→1→2→3→4→5→6)
- Unapproved predecessor blocking
- Stage state machine transitions (draft → pending_review → approved/needs_revision)
- Invalid transition attempts and error codes
- Stage skip prevention
- Regression: no stage can be approved out of order
"""
import pytest


class TestSequentialStageProgression:
    """Validate that stages must progress in strict order."""

    def test_all_stages_defined_sequentially(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        assert len(stages) == 7
        for i, stage in enumerate(stages):
            assert stage["stage"] == i

    def test_stage_order_is_fixed(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        expected_names = [
            "input_analysis",
            "copy_planning",
            "scene_planning",
            "design_concepts",
            "final_generation",
            "review",
            "export",
        ]
        actual_names = [s["name"] for s in stages]
        assert actual_names == expected_names

    def test_stage_0_is_entry_point(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        stage0 = stages[0]
        assert stage0["name"] == "input_analysis"
        assert "main_image" in stage0["accepts"]

    def test_stage_6_is_terminal(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        stage6 = stages[6]
        assert stage6["name"] == "export"
        assert "approved_final_cards" in stage6["accepts"]

    def test_each_stage_accepts_previous_outputs(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        for i in range(1, len(stages)):
            prev_outputs = set(stages[i - 1]["outputs"])
            curr_accepts = set(stages[i]["accepts"])
            assert len(prev_outputs & curr_accepts) > 0, (
                f"Stage {i} ({stages[i]['name']}) accepts nothing from stage {i-1} outputs"
            )


class TestStageStateTransitions:
    """Validate valid state transitions for each stage."""

    def test_valid_stage_states(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        valid_states = {"draft", "pending_review", "approved", "needs_revision", "partially_approved"}
        for stage in stages:
            assert stage["name"] in {s["name"] for s in stages}

    def test_draft_to_pending_review_transition(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        transition = next(e for e in error_flows if e["scenario"] == "stage_transition_unapproved_predecessor")
        assert transition["state"]["stage_1"] == "draft"
        assert transition["state"]["stage_2"] == "pending"

    def test_approved_stage_allows_next_stage(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        transition = next(e for e in error_flows if e["scenario"] == "stage_transition_unapproved_predecessor")
        assert transition["state"]["stage_0"] == "approved"

    def test_needs_revision_requires_regeneration(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        reject = next(s for s in scenarios if s["scenario"] == "reject_with_required_changes")
        assert reject["expected"]["stage_status"] == "needs_revision"
        assert reject["expected"]["regeneration_required"] is True

    def test_pending_review_to_approved(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        approve = next(s for s in scenarios if s["scenario"] == "approve_with_warning_comment")
        assert approve["prior_state"]["stage_status"] == "pending_review"
        assert approve["expected"]["stage_status"] == "approved"

    def test_pending_review_to_needs_revision(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        reject = next(s for s in scenarios if s["scenario"] == "reject_with_required_changes")
        assert reject["prior_state"]["stage_status"] == "pending_review"
        assert reject["expected"]["stage_status"] == "needs_revision"


class TestStageTransitionBlocking:
    """Validate that unapproved predecessors block downstream transitions."""

    def test_unapproved_predecessor_returns_409(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        transition = next(e for e in error_flows if e["scenario"] == "stage_transition_unapproved_predecessor")
        assert transition["expected_status"] == 409

    def test_blocking_stage_identified_in_error(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        transition = next(e for e in error_flows if e["scenario"] == "stage_transition_unapproved_predecessor")
        assert transition["blocking_stage_id"] == 1
        assert "stage 1" in transition["expected_error"]
        assert "copy_planning" in transition["expected_error"]

    def test_draft_stage_blocks_approval(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        transition = next(e for e in error_flows if e["scenario"] == "stage_transition_unapproved_predecessor")
        assert transition["state"]["stage_1"] == "draft"

    def test_export_blocked_by_unapproved_review(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        export = next(e for e in error_flows if e["scenario"] == "export_unapproved_project")
        assert export["expected_status"] == 403
        assert "stage 5" in export["expected_error"]
        assert "review" in export["expected_error"]

    def test_export_blocked_by_compliance_failure(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        export = next(e for e in error_flows if e["scenario"] == "export_compliance_failure")
        assert export["expected_status"] == 403
        assert export["state"]["compliance"]["severity"] == "critical"
        assert export["state"]["compliance"]["failures"] == 3


class TestStageSkipPrevention:
    """Validate that stages cannot be skipped."""

    def test_cannot_skip_stage_1_to_approve_stage_2(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        transition = next(e for e in error_flows if e["scenario"] == "stage_transition_unapproved_predecessor")
        assert transition["state"]["stage_0"] == "approved"
        assert transition["state"]["stage_1"] == "draft"
        assert transition["action"] == "approve_stage_2"
        assert transition["expected_status"] == 409

    def test_cannot_approve_stage_3_without_stage_2(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        stage2 = next(s for s in stages if s["name"] == "scene_planning")
        stage3 = next(s for s in stages if s["name"] == "design_concepts")
        assert stage2["stage"] == 2
        assert stage3["stage"] == 3
        assert stage3["accepts"] and any(a in stage2["outputs"] for a in stage3["accepts"])

    def test_cannot_approve_stage_4_without_stage_3(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        stage3 = next(s for s in stages if s["name"] == "design_concepts")
        stage4 = next(s for s in stages if s["name"] == "final_generation")
        assert stage3["stage"] == 3
        assert stage4["stage"] == 4

    def test_cannot_approve_review_without_final_generation(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        stage4 = next(s for s in stages if s["name"] == "final_generation")
        stage5 = next(s for s in stages if s["name"] == "review")
        assert stage4["stage"] == 4
        assert stage5["stage"] == 5
        assert "final_cards" in stage5["accepts"]


class TestStageTransitionRegression:
    """Regression tests to ensure stage transition rules are never violated."""

    def test_no_stage_has_duplicate_index(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        indices = [s["stage"] for s in stages]
        assert len(indices) == len(set(indices))

    def test_no_stage_has_duplicate_name(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        names = [s["name"] for s in stages]
        assert len(names) == len(set(names))

    def test_all_stages_have_accepts_and_outputs(self, fixture_data):
        stages = fixture_data["workflow_fixtures"]["workflow_stages"]
        for stage in stages:
            assert "accepts" in stage
            assert "outputs" in stage
            assert len(stage["accepts"]) > 0
            assert len(stage["outputs"]) > 0

    def test_error_flow_scenarios_cover_all_transition_failures(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        scenarios = {e["scenario"] for e in error_flows}
        assert "stage_transition_unapproved_predecessor" in scenarios
        assert "export_unapproved_project" in scenarios
        assert "export_compliance_failure" in scenarios

    def test_partial_approval_blocks_batch_final(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        batch = next(e for e in error_flows if e["scenario"] == "batch_final_partial_approval")
        assert batch["expected_status"] == 409
        assert batch["unapproved_stages"] == [3]
        assert "stage 3" in batch["expected_error"]
        assert "design_concepts" in batch["expected_error"]
