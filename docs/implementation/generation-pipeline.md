# Generation pipeline

Task: `095258be-e6bd-44d5-8ad1-98d543547228`

## Purpose
The generation pipeline turns a validated brief into a staged set of CardFlow outputs. The key requirement is not one-off image generation, but a consistent multi-card series with controlled regeneration.

## Workflow summary
1. Step 0 passes the validated brief and analysis results into the generation pipeline.
2. The pipeline creates a staged plan.
3. Each stage is executed asynchronously.
4. Generated artifacts are stored with traceable lineage.
5. Targeted regeneration can replace one stage, one card, or one element without losing the history of earlier outputs.

## Implementation notes
- Separate orchestration from rendering.
  - Orchestration decides what to generate next.
  - Rendering produces the actual artifact.
- Make every stage resumable.
- Keep stage boundaries explicit so operators can see where work is stuck.
- Record prompt version, workflow version, seed, model ID, and input references for every generated item.
- Preserve prior versions; never overwrite a finished generation artifact.

## Suggested pipeline states
- queued
- running
- blocked
- succeeded
- failed
- regenerating
- superseded

## Artifact contract
Every generated artifact should include:
- workflow step or stage name
- source input version
- version number
- branch or regeneration lineage
- provenance metadata
- storage location or asset reference
- human-readable summary of what changed

## Targeted regeneration
Targeted regeneration should support:
- rerun of a full stage
- rerun of a single card
- rerun of a specific element inside a card

Rules:
- Prior outputs remain available for comparison.
- Regeneration creates a new version on the same lineage or a clearly linked branch.
- Downstream stages should not silently consume a replaced artifact without an explicit handoff.

## Operational runbook
### Healthy pipeline behavior
- Queue depth stays bounded.
- Stage durations are visible.
- Failures are isolated to the failing stage.
- Operators can explain which version fed which output.

### Failure handling
- Stage failure: mark the stage failed, record the error, and preserve prior versions.
- Partial failure: pause downstream stages until the missing artifact is resolved.
- Regeneration failure: keep the prior approved artifact available.

### Smoke checks
- Run one brief through the full staged pipeline.
- Confirm each stage is enqueued and completed asynchronously.
- Trigger a targeted regeneration for one card.
- Confirm the new artifact keeps lineage and the old one remains available.

## Gaps / questions
- What are the canonical stage names in the approved planner dossier?
- Which queue names and worker names should the docs use?
- Is the MVP generating 8 cards strictly, or is that configurable by project?
- What is the final retention window for superseded artifacts?
