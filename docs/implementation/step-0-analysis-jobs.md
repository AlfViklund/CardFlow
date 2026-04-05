# Step 0 rules and analysis jobs

Task: `1db4d9ef-f4ff-4804-a082-052b92dff742`

## Purpose
Step 0 is the intake and analysis gate. It turns a raw product brief and input assets into a normalized, validated package that later stages can trust.

## Workflow summary
1. User submits product data and source assets.
2. Intake validates required fields and file types.
3. Analysis jobs inspect the brief and assets.
4. The workflow either passes to the next stage or blocks with explicit reasons.
5. Every analysis result is traceable back to the input version that produced it.

## Implementation notes
- Keep validation separate from analysis.
  - Validation answers: is the input structurally acceptable?
  - Analysis answers: is the input good enough to continue?
- Run analysis asynchronously so large inputs do not block the UI.
- Make analysis idempotent. Re-running the same input version should not create conflicting state.
- Store analysis outputs as versioned records, not mutable flags.
- Persist the reason for every block so the operator can explain the decision later.

## Job model
A Step 0 analysis job should carry:
- input version or checksum
- product/brief identifier
- analysis type
- job status
- blocking reason codes
- generated notes or findings
- created/updated timestamps
- retry count and last error

## Operational runbook
### When to use the analysis job queue
- New brief is uploaded
- Source images are replaced
- Validation rules change and the input must be re-evaluated
- An operator requests a re-run for a specific version

### What operators should look at
- Validation outcome
- Analysis status
- Blocking reason codes
- Whether the input version matches the current active workflow version

### Failure handling
- Validation failure: stop immediately and return a human-readable reason.
- Analysis failure: mark the job failed, keep the input version intact, and allow retry.
- Queue backlog: show queue depth and oldest job age.

### Smoke checks
- Submit a valid brief and one image.
- Confirm validation passes.
- Confirm the analysis job is created and finishes.
- Confirm the workflow either advances or emits a clear block reason.

## Gaps / questions
- Which analysis engine is the planner package expecting for Step 0?
- What exact input types are supported in MVP beyond image and text?
- What block reasons are considered user-fixable versus operator-only?
- What are the final retry and timeout policies for Step 0 jobs?
