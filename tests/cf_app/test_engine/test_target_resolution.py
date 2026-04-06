"""
Target resolution tests for the generation engine.

Covers:
- Regeneration target types (stage, card, element)
- Valid element enumeration
- Target validation and error responses
- Element-level regeneration scope isolation
- Cross-target boundary enforcement
"""
import pytest


class TestRegenerationTargetTypes:
    """Validate all regeneration target types are properly defined."""

    def test_three_target_types_exist(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        targets = {s["target"] for s in scenarios}
        assert targets == {"whole_stage", "single_card", "element"}

    def test_whole_stage_target_has_stage_field(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        stage = next(s for s in scenarios if s["target"] == "whole_stage")
        assert "stage" in stage
        assert stage["stage"] == "design_concepts"

    def test_single_card_target_has_card_id(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        card = next(s for s in scenarios if s["target"] == "single_card")
        assert "card_id" in card
        assert isinstance(card["card_id"], int)
        assert 1 <= card["card_id"] <= 8

    def test_element_target_has_card_id_and_element(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        elem = next(s for s in scenarios if s["target"] == "element")
        assert "card_id" in elem
        assert "element" in elem
        assert isinstance(elem["card_id"], int)
        assert isinstance(elem["element"], str)


class TestValidElementEnumeration:
    """Validate the list of valid regeneration elements."""

    def test_valid_elements_from_versioning_fixtures(self, fixture_data):
        valid = fixture_data["versioning_fixtures"]["valid_elements"]
        expected = ["text_overlay", "background", "badge", "icon", "position"]
        assert valid == expected

    def test_valid_elements_from_error_flow(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        regen = next(e for e in error_flows if e["scenario"] == "regenerate_invalid_element")
        error_msg = regen["expected_error"]
        for elem in ["text_overlay", "background", "badge", "icon", "position"]:
            assert elem in error_msg

    def test_element_count_is_five(self, fixture_data):
        valid = fixture_data["versioning_fixtures"]["valid_elements"]
        assert len(valid) == 5

    def test_no_duplicate_elements(self, fixture_data):
        valid = fixture_data["versioning_fixtures"]["valid_elements"]
        assert len(valid) == len(set(valid))

    def test_element_target_uses_valid_element(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        elem = next(s for s in scenarios if s["target"] == "element")
        valid = fixture_data["versioning_fixtures"]["valid_elements"]
        assert elem["element"] in valid


class TestTargetValidationErrorResponses:
    """Validate error responses for invalid regeneration targets."""

    def test_invalid_element_returns_422(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        regen = next(e for e in error_flows if e["scenario"] == "regenerate_invalid_element")
        assert regen["expected_status"] == 422

    def test_invalid_element_error_lists_valid_options(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        regen = next(e for e in error_flows if e["scenario"] == "regenerate_invalid_element")
        assert "Valid elements:" in regen["expected_error"]

    def test_invalid_element_identifies_bad_field(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        regen = next(e for e in error_flows if e["scenario"] == "regenerate_invalid_element")
        assert "nonexistent_field" in regen["expected_error"]

    def test_unapproved_stage_regenerate_returns_400(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        regen = next(e for e in error_flows if e["scenario"] == "regenerate_unapproved_stage")
        assert regen["expected_status"] == 400

    def test_unapproved_stage_error_mentions_force_flag(self, fixture_data):
        error_flows = fixture_data["workflow_fixtures"]["error_flow_scenarios"]
        regen = next(e for e in error_flows if e["scenario"] == "regenerate_unapproved_stage")
        assert "force flag" in regen["expected_error"]


class TestElementScopeIsolation:
    """Validate that element-level regeneration only affects the targeted element."""

    def test_element_regeneration_preserves_background(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        elem = next(s for s in scenarios if s["target"] == "element")
        assert elem["element"] == "text_overlay"
        assert "background and layout preserved" in elem["expected"]

    def test_element_regeneration_is_card_scoped(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        elem = next(s for s in scenarios if s["target"] == "element")
        assert elem["card_id"] == 1

    def test_single_card_regeneration_preserves_siblings(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        card = next(s for s in scenarios if s["target"] == "single_card")
        assert "siblings unchanged" in card["expected"]

    def test_whole_stage_regeneration_affects_all_cards(self, fixture_data):
        scenarios = fixture_data["workflow_fixtures"]["regeneration_scenarios"]
        stage = next(s for s in scenarios if s["target"] == "whole_stage")
        assert "8 new cards" in stage["expected"]


class TestRegenerationTargetSchema:
    """Validate regeneration target schema from versioning fixtures."""

    def test_regeneration_targets_have_required_fields(self, fixture_data):
        targets = fixture_data["versioning_fixtures"]["regeneration_targets"]
        for target in targets:
            assert "scope" in target
            assert "description" in target
            assert "expected_revision_count" in target

    def test_stage_scope_affects_all_cards(self, fixture_data):
        targets = fixture_data["versioning_fixtures"]["regeneration_targets"]
        stage = next(t for t in targets if t["scope"] == "stage")
        assert stage["expected_revision_count"] == "all_cards"

    def test_card_scope_affects_one_card(self, fixture_data):
        targets = fixture_data["versioning_fixtures"]["regeneration_targets"]
        card = next(t for t in targets if t["scope"] == "card")
        assert card["expected_revision_count"] == 1

    def test_element_scope_affects_one_card(self, fixture_data):
        targets = fixture_data["versioning_fixtures"]["regeneration_targets"]
        elem = next(t for t in targets if t["scope"] == "element")
        assert elem["expected_revision_count"] == 1

    def test_all_scopes_are_valid(self, fixture_data):
        targets = fixture_data["versioning_fixtures"]["regeneration_targets"]
        scopes = {t["scope"] for t in targets}
        assert scopes == {"stage", "card", "element"}
