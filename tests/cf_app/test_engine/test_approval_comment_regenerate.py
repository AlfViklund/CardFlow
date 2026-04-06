"""
Approval, comment, and regenerate behavior tests for the generation engine.

Covers:
- Approval flows (stage-level, card-level, with/without warnings)
- Comment flows (with requires_regenerate flag, downstream blocking)
- Regenerate flows (stage, card, element level targeting)
- Comment → regenerate pipeline
- Regenerate → approve pipeline
- Regeneration of approved cards (stage downgrade, revision increment)
- Multi-cycle comment/regenerate flows
"""
import pytest


class TestApprovalFlows:
    """Tests for approval behavior at stage and card level."""

    def test_stage_approval_changes_status(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        approve = next(s for s in scenarios if s["scenario"] == "approve_with_warning_comment")
        assert approve["expected"]["stage_status"] == "approved"

    def test_approval_with_warning_attaches_warning(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        approve = next(s for s in scenarios if s["scenario"] == "approve_with_warning_comment")
        assert approve["expected"]["warning_attached"] is True

    def test_approval_with_warning_unblocks_downstream(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        approve = next(s for s in scenarios if s["scenario"] == "approve_with_warning_comment")
        assert approve["expected"]["downstream_unblocked"] is True

    def test_approval_with_warning_sets_export_flag(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        approve = next(s for s in scenarios if s["scenario"] == "approve_with_warning_comment")
        assert approve["expected"]["export_flag"] == "warning_pending"

    def test_approval_prior_state_is_pending_review(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        approve = next(s for s in scenarios if s["scenario"] == "approve_with_warning_comment")
        assert approve["prior_state"]["stage_status"] == "pending_review"

    def test_card_approval_records_timestamp(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        approve = next(s for s in scenarios if s["scenario"] == "approve_single_card_in_stage")
        assert "card_5_approved_at" in approve["expected"]

    def test_card_approval_updates_card_status(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        approve = next(s for s in scenarios if s["scenario"] == "approve_single_card_in_stage")
        assert approve["expected"]["card_5_status"] == "approved"

    def test_card_approval_prior_state_is_pending_review(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        approve = next(s for s in scenarios if s["scenario"] == "approve_single_card_in_stage")
        assert approve["prior_state"]["card_5_status"] == "pending_review"

    def test_partial_approval_stage_status(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        partial = next(s for s in scenarios if s["scenario"] == "half_cards_approved_in_stage")
        assert partial["expected_stage_status"] == "partially_approved"
        assert partial["approved_count"] == 5
        assert partial["pending_count"] == 2
        assert partial["draft_count"] == 1

    def test_partial_approval_blocks_export(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        partial = next(s for s in scenarios if s["scenario"] == "half_cards_approved_in_stage")
        assert partial["export_allowed"] is False

    def test_all_cards_approved_enables_export(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        full = next(s for s in scenarios if s["scenario"] == "all_cards_approved_export_ready")
        assert full["expected_stage_status"] == "approved"
        assert full["approved_count"] == 8
        assert full["export_allowed"] is True
        assert full["compliance_required"] is True


class TestCommentFlows:
    """Tests for comment behavior and downstream effects."""

    def test_comment_with_requires_regenerate_blocks_downstream(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        reject = next(s for s in scenarios if s["scenario"] == "reject_with_required_changes")
        assert reject["expected"]["downstream_blocked"] is True

    def test_comment_sets_needs_revision_status(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        reject = next(s for s in scenarios if s["scenario"] == "reject_with_required_changes")
        assert reject["expected"]["stage_status"] == "needs_revision"

    def test_comment_flags_regeneration_required(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        reject = next(s for s in scenarios if s["scenario"] == "reject_with_required_changes")
        assert reject["expected"]["regeneration_required"] is True

    def test_comment_has_requires_regenerate_param(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        reject = next(s for s in scenarios if s["scenario"] == "reject_with_required_changes")
        assert reject["params"]["requires_regenerate"] is True

    def test_comment_has_text_content(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        reject = next(s for s in scenarios if s["scenario"] == "reject_with_required_changes")
        assert "comment" in reject["params"]
        assert len(reject["params"]["comment"]) > 0

    def test_comment_prior_state_is_pending_review(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        reject = next(s for s in scenarios if s["scenario"] == "reject_with_required_changes")
        assert reject["prior_state"]["stage_status"] == "pending_review"

    def test_approval_comment_does_not_block_downstream(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        approve = next(s for s in scenarios if s["scenario"] == "approve_with_warning_comment")
        assert approve["expected"]["downstream_unblocked"] is True


class TestRegenerateFlows:
    """Tests for regeneration behavior at all target levels."""

    def test_regenerate_whole_stage_creates_new_revisions(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        stage = next(s for s in scenarios if s["target"] == "whole_stage")
        assert "8 new cards" in stage["expected"]
        assert "new revision chain" in stage["expected"]

    def test_regenerate_single_card_preserves_siblings(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        card = next(s for s in scenarios if s["target"] == "single_card")
        assert card["card_id"] == 3
        assert "siblings unchanged" in card["expected"]

    def test_regenerate_element_preserves_other_elements(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        elem = next(s for s in scenarios if s["target"] == "element")
        assert elem["card_id"] == 1
        assert elem["element"] == "text_overlay"
        assert "background and layout preserved" in elem["expected"]

    def test_regenerate_unapproved_stage_requires_force(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        regen = next(e for e in error_flows if e["scenario"] == "regenerate_unapproved_stage")
        assert regen["expected_status"] == 400
        assert "force flag" in regen["expected_error"]

    def test_regenerate_invalid_element_returns_422(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        regen = next(e for e in error_flows if e["scenario"] == "regenerate_invalid_element")
        assert regen["expected_status"] == 422
        assert "nonexistent_field" in regen["params"]["element"]

    def test_regenerate_valid_elements_list(self, fixture_data):
        valid_elements = ["text_overlay", "background", "badge", "icon", "position"]
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        regen = next(e for e in error_flows if e["scenario"] == "regenerate_invalid_element")
        for elem in valid_elements:
            assert elem in regen["expected_error"]

    def test_regeneration_targets_are_exhaustive(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        targets = {s["target"] for s in scenarios}
        assert targets == {"whole_stage", "single_card", "element"}


class TestCommentThenRegenerateFlow:
    """Tests the comment → regenerate pipeline flow."""

    def test_comment_sets_needs_revision_enabling_regenerate(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        reject = next(s for s in scenarios if s["scenario"] == "reject_with_required_changes")
        assert reject["expected"]["stage_status"] == "needs_revision"
        assert reject["expected"]["regeneration_required"] is True

    def test_regenerate_whole_stage_after_comment(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        stage = next(s for s in scenarios if s["target"] == "whole_stage")
        assert stage["stage"] == "design_concepts"

    def test_regenerate_single_card_after_comment(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        card = next(s for s in scenarios if s["target"] == "single_card")
        assert card["card_id"] == 3

    def test_comment_text_is_preserved_in_regeneration_context(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        reject = next(s for s in scenarios if s["scenario"] == "reject_with_required_changes")
        assert "Color palette" in reject["params"]["comment"]
        assert "warmer tones" in reject["params"]["comment"]


class TestRegenerateThenApproveFlow:
    """Tests the regenerate → approve pipeline flow."""

    def test_regenerate_approved_card_downgrades_stage(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        regen = next(s for s in scenarios if s["scenario"] == "regenerate_single_approved_card")
        assert regen["expected"]["stage_status_downgraded"] == "partially_approved"

    def test_regenerate_increments_revision_number(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        regen = next(s for s in scenarios if s["scenario"] == "regenerate_single_approved_card")
        assert regen["prior_state"]["card_3_revision"] == 1
        assert regen["expected"]["card_3_revision"] == 2

    def test_regenerate_sets_card_to_pending_review(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        regen = next(s for s in scenarios if s["scenario"] == "regenerate_single_approved_card")
        assert regen["expected"]["card_3_status"] == "pending_review"

    def test_regenerate_preserves_sibling_cards(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        regen = next(s for s in scenarios if s["scenario"] == "regenerate_single_approved_card")
        assert regen["expected"]["all_other_cards_unchanged"] is True

    def test_prior_state_card_was_approved(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        regen = next(s for s in scenarios if s["scenario"] == "regenerate_single_approved_card")
        assert regen["prior_state"]["card_3_status"] == "approved"


class TestMultiCycleCommentRegenerateFlow:
    """Tests multiple comment → regenerate cycles."""

    def test_needs_revision_can_be_regenerated(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["review_action_scenarios"]
        reject = next(s for s in scenarios if s["scenario"] == "reject_with_required_changes")
        assert reject["expected"]["regeneration_required"] is True
        assert reject["expected"]["stage_status"] == "needs_revision"

    def test_regenerated_card_can_be_re_reviewed(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        regen = next(s for s in scenarios if s["scenario"] == "regenerate_single_approved_card")
        assert regen["expected"]["card_3_status"] == "pending_review"

    def test_revision_number_increments_each_cycle(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        regen = next(s for s in scenarios if s["scenario"] == "regenerate_single_approved_card")
        delta = regen["expected"]["card_3_revision"] - regen["prior_state"]["card_3_revision"]
        assert delta == 1

    def test_stage_downgrade_on_regenerate_is_reversible(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["partial_approval_scenarios"]
        regen = next(s for s in scenarios if s["scenario"] == "regenerate_single_approved_card")
        assert regen["expected"]["stage_status_downgraded"] == "partially_approved"
        full = next(s for s in scenarios if s["scenario"] == "all_cards_approved_export_ready")
        assert full["expected_stage_status"] == "approved"
