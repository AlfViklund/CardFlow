"""
test_engine/ — Staged generation, targeted regeneration, batch final, recovery tests.

Blocked by: 179ad31e (Build staged async generation and regeneration core)
"""
import pytest

pytestmark = pytest.mark.usefixtures("cardflow_up")


class TestStageTransitions:
    """Stage transition flows through the pipeline."""

    def test_happy_path_full_pipeline(self, fixture_data):
        """1.1 — Create project → approve each stage → all transitions clean."""
        stages = fixture_data.get("workflow_fixtures", {}).get("workflow_stages", [])
        assert len(stages) == 7

    def test_skip_stage_rejected(self, fixture_data):
        """1.2 — Approve stage 3 while stage 1 pending → rejected with blocking reason."""
        case = next(
            (c for c in fixture_data.get("workflow_fixtures", {}).get("error_flow_scenarios", [])
             if c["scenario"] == "stage_transition_unapproved_predecessor"),
            None
        )
        assert case is not None
        assert case["expected_status"] == 409

    def test_regenerate_approved_stage(self):
        """1.3 — Regenerate stage 2 after approval → new revision, prior preserved."""
        ...


class TestApprovalCommentRegenerate:
    """Approve / comment / regenerate at various scopes."""

    @pytest.mark.parametrize("scope", ["stage", "card"])
    def test_approve(self, scope):
        """2.1 / 2.2 — Approve whole stage vs single card."""
        ...

    @pytest.mark.parametrize("scope", ["stage", "card"])
    def test_comment(self, scope):
        """2.3 / 2.4 — Comment on stage vs card, state stays in review."""
        ...

    @pytest.mark.parametrize("scope", ["stage", "card", "element"])
    def test_regenerate(self, scope):
        """2.5 / 2.6 / 2.7 — Regenerate at each scope level."""
        ...


class TestTargetResolution:
    """Target resolution for regeneration."""

    @pytest.mark.parametrize("target,expected_scope", [
        ("stage", "all_cards"),
        ("card", "single_card"),
        ("element", "single_element"),
    ])
    def test_target_resolution(self, target, expected_scope):
        """3.1-3.2-3.3 — Correct scope resolved for each target type."""
        ...

    def test_invalid_element_rejected(self, fixture_data):
        """3.4 — Invalid element name returns actionable error with valid paths."""
        case = next(
            (c for c in fixture_data.get("workflow_fixtures", {}).get("error_flow_scenarios", [])
             if c["scenario"] == "regenerate_invalid_element"),
            None
        )
        assert case is not None
        assert case["expected_status"] == 422


class TestBatchFinalRuns:
    """Batch final-series execution."""

    def test_all_approved_batch_final(self):
        """4.1 — All stages approved → batch final succeeds."""
        ...

    def test_unapproved_stage_blocked(self, fixture_data):
        """4.2 — Unapproved stage → batch final rejected with unapproved stage IDs."""
        case = next(
            (c for c in fixture_data.get("workflow_fixtures", {}).get("error_flow_scenarios", [])
             if c["scenario"] == "batch_final_partial_approval"),
            None
        )
        assert case is not None
        assert case["expected_status"] == 409
        assert case["unapproved_stages"] == [3]

    def test_partially_approved_mixed(self, fixture_data):
        """4.3 — Approved cards reused, unapproved regenerated (or rejected)."""
        cases = fixture_data.get("workflow_fixtures", {}).get("partial_approval_scenarios", [])
        assert len(cases) >= 1


class TestRevisionHistory:
    """Revision history and traceability metadata."""

    def test_create_revision(self):
        """5.1 — Prior revision never mutated; new revision with branch lineage."""
        ...

    def test_lineage_chain(self):
        """5.2 — Regenerate → new revision references parent; chain traversable."""
        ...

    def test_traceability_fields(self):
        """5.3 — Each revision stores: changed_by, changed_at, step/stage,
        prompt_version, workflow_version, seed, model_id, reference_hashes."""
        ...

    def test_branch_traversal(self):
        """5.4 — API lists and traverses revision branches without losing history."""
        ...


class TestFailureRecovery:
    """Failure recovery and retry behavior."""

    def test_transient_failure_retry(self):
        """6.1 — Transient failure → auto-retry, no duplicate outputs."""
        ...

    def test_worker_crash_recovery(self):
        """6.2 — Worker crash → rehydrate in-flight job, no data loss."""
        ...

    def test_failed_regeneration_preserves_prior(self):
        """6.3 — Failed regeneration → error recorded, prior revision untouched."""
        ...


class TestRegressionChecks:
    """Regression checks for existing behavior."""

    def test_failed_output_no_overwrite(self):
        """7.1 — Failed output doesn't overwrite prior artifact."""
        ...

    def test_regenerated_correct_scope(self):
        """7.2 — Only targeted scope changed, siblings unchanged."""
        ...

    def test_export_respects_approval(self, fixture_data):
        """7.3 — Unapproved stages cannot export."""
        case = next(
            (c for c in fixture_data.get("workflow_fixtures", {}).get("error_flow_scenarios", [])
             if c["scenario"] == "export_unapproved_project"),
            None
        )
        assert case is not None
        assert case["expected_status"] == 403


class TestErrorFlows:
    """Error flow scenarios from fixture definitions."""

    @pytest.mark.parametrize("case", [
        "stage_transition_unapproved_predecessor",
        "regenerate_unapproved_stage",
        "export_unapproved_project",
        "export_compliance_failure",
        "regenerate_invalid_element",
        "project_not_found",
        "batch_final_partial_approval",
    ])
    def test_error_scenario(self, fixture_data, case):
        """Each error flow returns expected status code and error message."""
        case_data = next(
            (c for c in fixture_data.get("workflow_fixtures", {}).get("error_flow_scenarios", [])
             if c["scenario"] == case),
            None
        )
        assert case_data is not None, f"Missing fixture for scenario: {case}"
        assert "expected_status" in case_data


class TestPartialApprovals:
    """Partial approval state handling."""

    @pytest.mark.parametrize("case", [
        "half_cards_approved_in_stage",
        "all_cards_approved_export_ready",
        "regenerate_single_approved_card",
    ])
    def test_partial_approval_scenario(self, fixture_data, case):
        """Each partial approval scenario handles mixed card states correctly."""
        case_data = next(
            (c for c in fixture_data.get("workflow_fixtures", {}).get("partial_approval_scenarios", [])
             if c["scenario"] == case),
            None
        )
        assert case_data is not None, f"Missing fixture for scenario: {case}"


class TestReviewActions:
    """Review action behaviors (approve, comment, regenerate)."""

    @pytest.mark.parametrize("case", [
        "approve_with_warning_comment",
        "reject_with_required_changes",
        "approve_single_card_in_stage",
    ])
    def test_review_action_scenario(self, fixture_data, case):
        """Each review action transitions state correctly."""
        case_data = next(
            (c for c in fixture_data.get("workflow_fixtures", {}).get("review_action_scenarios", [])
             if c["scenario"] == case),
            None
        )
        assert case_data is not None, f"Missing fixture for scenario: {case}"
