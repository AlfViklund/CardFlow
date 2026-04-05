# Compliance runbook and rollout controls

Task: `72346f88-cb92-4bca-be64-105d2adc6b3c`

## Purpose
This runbook explains how CardFlow enforces marketplace compliance, how export blocking works, and how operators should manage rule changes safely.

## Policy summary
- Wildberries-first behavior is the default when WB and Ozon rules conflict.
- The strictest applicable rule wins.
- Compliance checks happen before export and before any user-visible approval that depends on export readiness.
- Export is blocked when a required rule fails.

## Operational behavior
### Rule precedence
1. Board/project-specific overrides
2. Marketplace-specific rules
3. Strictest shared constraint
4. Default template behavior

### Blocking behavior
A block must include:
- rule identifier
- failing field or artifact
- severity
- human-readable explanation
- next action for the operator or user

### Validation report
The validation report should show:
- pass/fail state per rule group
- reason for every failure
- whether the issue blocks export
- whether the issue can be auto-fixed or must be edited manually

## Rollout controls
- Ship new rules behind a versioned config.
- Compare old and new rule results before switching defaults.
- Keep rollback simple: a rule version change should be reversible without data migration.
- Log which rule version was active when each validation ran.

## Monitoring and alerting
Watch for:
- sudden spikes in export blocks
- missing validation reports
- rule evaluation failures
- unexpected changes in the pass/fail ratio

## Operator runbook
### To inspect a failed export
1. Open the validation report.
2. Identify the first blocking rule.
3. Check whether the failure is content-related or config-related.
4. Decide whether to fix content, update the rule version, or roll back the rule change.

### To roll out a new rule version
1. Validate the rule set in staging.
2. Compare output against the current production version.
3. Announce the change to the team if behavior changes materially.
4. Switch the active version.
5. Watch for export-block spikes and validation errors.

### To roll back a rule version
1. Revert the active config pointer.
2. Confirm validation results return to expected behavior.
3. Check that recent failed exports still show the original blocking reason.

## Gaps / questions
- What is the exact compliance score formula, if any, in the approved dossier?
- Which alert channel owns export-block spikes?
- What are the final block reason codes for WB versus Ozon?
- Do we expect rule changes to require manual approval before production rollout?
