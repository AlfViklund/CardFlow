# Revision rules and operational rollout for provenance storage

Task: `09124ab1-96d9-40e8-b144-eaaf781cb4b9`

## Purpose
This runbook explains how CardFlow stores immutable revisions, manages branches, and preserves provenance so the team can inspect or recover the full history of generated work.

## Revision policy
- Significant outputs are immutable once created.
- Edits and regenerations create new revision records.
- A revision must link back to its parent or branch origin.
- No approved artifact should be overwritten in place.

## Provenance metadata
Each revision should capture:
- who changed it
- when it changed
- workflow step or stage
- prompt version
- workflow version
- seed or generation parameters
- model ID
- source asset hashes or references
- parent revision or branch pointer

## Branch semantics
Use branches when a user wants an alternate direction instead of a direct replacement.

Rules:
- The original revision stays intact.
- The alternate branch gets its own lineage.
- The UI should make branch choice visible so operators do not confuse alternatives with replacements.

## Storage and migration notes
- Add new provenance fields in a backward-compatible way.
- Backfill old records where possible.
- Keep null handling explicit for legacy items that do not yet have full provenance.
- Do not block the whole rollout if old records are missing optional provenance fields.

## Rollback safety
A rollback must not erase history.
- If a rollout fails, revert the schema/config pointer, not the history table.
- Keep the old provenance records readable.
- Make sure the recovery path still shows the original branch and lineage.

## Inspection workflow
Operators should be able to answer:
- What changed?
- Who changed it?
- Which branch is active?
- What was the parent version?
- Which prompt/model/version produced this record?

## Operational runbook
### To inspect a lineage issue
1. Find the newest revision.
2. Trace back to the parent revision.
3. Confirm the branch marker and source asset hashes.
4. Check whether the latest revision is the approved one or just an alternate branch.

### To run a provenance migration
1. Deploy the schema or storage change.
2. Backfill metadata for existing records.
3. Verify a sample of old and new revisions.
4. Confirm read paths still show the same history.

### To recover from a bad provenance rollout
1. Revert the config or schema pointer.
2. Confirm old revisions remain readable.
3. Re-run inspection on a known-good lineage.

## Gaps / questions
- What is the final storage table or document shape for revisions?
- How long must provenance history be retained?
- Which UI or operator tool is used to inspect lineage in production?
- What is the approved backfill strategy for legacy revisions?
