"""
test_compliance/ — WB/Ozon compliance rules, export blocking, review flows.

Blocked by: 3f40bd18 (Implement WB-first compliance engine)
"""
import pytest

pytestmark = pytest.mark.usefixtures("cardflow_up")


class TestProhibitedContent:
    """Prohibited content detection."""

    @pytest.mark.parametrize("field", ["title", "description"])
    def test_wb_prohibited_keyword(self, field):
        """1.1 / 1.2 — WB prohibited keyword detected in title/description."""
        ...

    def test_ozon_only_keyword(self):
        """1.3 — Ozon-only keyword: not flagged for WB-only, flagged for Ozon/combined."""
        ...

    def test_wb_ozon_strictest(self):
        """1.4 — WB+Ozon: keyword prohibited by only one marketplace → flagged."""
        ...

    def test_false_positive_allowed_term(self):
        """1.5 — Similar but allowed term not flagged."""
        ...


class TestVisibilityQuality:
    """Visibility and quality rule checks."""

    def test_missing_mandatory_attribute(self):
        """2.1 — Missing mandatory attribute → compliance failure."""
        ...

    def test_image_below_resolution(self):
        """2.2 — Image below minimum resolution → quality failure, blocks export."""
        ...

    def test_watermark_detected(self):
        """2.3 — Watermark/overlay detected → warning or failure per severity."""
        ...


class TestStrictestRuleMerging:
    """WB+Ozon rule merging behavior."""

    def test_wb_stricter(self):
        """3.1 — WB stricter → WB rule wins."""
        ...

    def test_ozon_stricter(self):
        """3.2 — Ozon stricter → Ozon rule wins."""
        ...

    def test_both_prohibit_same(self):
        """3.3 — Both prohibit → single failure, correct severity."""
        ...

    def test_rule_conflict_blocking(self):
        """3.4 — One allows, one blocks → stricter (blocking) rule wins."""
        ...


class TestComplianceScoring:
    """Scoring and severity calculation."""

    def test_no_failures(self):
        """4.1 — No failures: score=100, severity=pass."""
        ...

    def test_single_warning(self):
        """4.2 — Single warning: proportional score reduction, severity=warning."""
        ...

    def test_single_critical(self):
        """4.3 — Single critical failure: score=0/threshold, severity=critical."""
        ...

    def test_multiple_mixed(self):
        """4.4 — Multiple mixed severity: score reflects all, severity=highest."""
        ...


class TestExportBlocking:
    """Export blocking behavior."""

    def test_critical_blocks_export(self):
        """5.1 — Critical failure → export blocked with failure reason."""
        ...

    def test_resolved_unblocks(self):
        """5.2 — All warnings resolved → export unblocked."""
        ...

    def test_downgraded_unblocks(self):
        """5.3 — Critical downgraded → export unblocked."""
        ...


class TestReviewActions:
    """Approve/comment/regenerate for compliance."""

    def test_approve_stage(self):
        """6.1 — Approve whole stage (compliance passed) → export unlocked."""
        ...

    def test_approve_single_card(self):
        """6.2 — Approve single card → only that card passes export gate."""
        ...

    def test_regenerate_after_failure(self):
        """6.4 — Regenerate after compliance failure → new revision, re-checked."""
        ...

    def test_per_card_regenerate(self):
        """6.5 — Per-card regenerate → only failing card regenerated."""
        ...


class TestValidationReports:
    """Validation report structure."""

    def test_structured_failure(self):
        """7.1 — Each failure has rule reference, severity, field, actionable reason."""
        ...

    def test_reproducible(self):
        """7.2 — Same inputs → same validation result."""
        ...

    def test_mixed_pass_fail(self):
        """7.3 — Report clearly separates passing and failing items."""
        ...


class TestExportComplianceError:
    """Export blocked by compliance failure — fixture-driven."""

    def test_export_compliance_failure(self, fixture_data):
        """Export attempt with critical compliance failures → 403."""
        case = next(
            (c for c in fixture_data.get("workflow_fixtures", {}).get("error_flow_scenarios", [])
             if c["scenario"] == "export_compliance_failure"),
            None
        )
        assert case is not None
        assert case["expected_status"] == 403
        assert case["state"]["compliance"]["severity"] == "critical"
