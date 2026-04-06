# Step 0: Input Ingestion & Analysis

Task: `1db4d9ef-f4ff-4804-a082-052b92dff742`
Last updated: 2026-04-06

## Purpose
Step 0 is the intake gate. It turns a raw product brief and source images into a validated, analysed package that later stages can trust. If Step 0 fails, nothing downstream runs.

## Workflow Summary

```
User submits → Validation → Analysis → [block or pass] → downstream
     ↓              ↓            ↓
  base64       schema check   quality risks
  + brief      type check     inferred attrs
               size/ratio     blocking reasons
```

## Input Schema

An ingestion request carries:

| Field | Type | Limits |
|--|--|--|
| `projectId` | UUID | required |
| `mainImage` | `{filename, contentBase64}` | filename ≤ 200 chars |
| `additionalImages` | array | max 20 |
| `referenceImages` | array | max 5 (`MAX_REFERENCE_IMAGES`) |
| `brief` | string | max 20,000 chars |

Total images (main + additional + reference) must not exceed **30** (`MAX_TOTAL_IMAGES`).

## Validation Rules

### Per-Marketplace Upload Rules

| Rule | Wildberries | Ozon |
|--|--|--|
| Min dimension | 900px | 400px |
| Max dimension | 10,000px | 8,000px |
| Max file size | 10 MB | 15 MB |
| Accepted formats | JPEG, PNG, WebP | JPEG, PNG, WebP, HEIC |
| Max additional photos | 20 | 10 |

### Combined Marketplace Rules (strictest merge)

When both marketplaces are selected:
- **Min dimension** = *max*(WB, Ozon) → 900px
- **Max dimension** = *min*(WB, Ozon) → 8,000px
- **Max file size** = *min*(WB, Ozon) → 10 MB
- **Accepted formats** = intersection → JPEG, PNG, WebP
- **Max additional photos** = *min*(WB, Ozon) → 10
- **Required fields** = union → `mainImage`, `marketplaces`

### Quality Risk Codes

| Code | Severity | Meaning |
|--|--|--|
| `low_resolution` | blocker | Image below minimum dimension |
| `oversized_file` | blocker | File exceeds max size |
| `unsupported_format` | blocker | MIME type not accepted |
| `aspect_ratio_extreme` | warning | Extreme aspect ratio |
| `missing_background_info` | warning | No background classification |
| `watermark_detected` | blocker | Watermark found |

### Validation Result

The validation response contains:
- `canApprove` — boolean: can proceed to analysis
- `rules` — array of rule check results (code, marketplace, field, message, is_blocking)
- `blockingCodes` — codes that block ingestion
- `warningCodes` — codes that warn but don't block

## Analysis Output

A Step 0 analysis record contains:

| Field | Description |
|--|--|
| `mainImage` | Image metadata (width, height, mimeType, byteSize, sha256, filename) |
| `additionalImages` | Array of image metadata (up to 20) |
| `referenceImages` | Array of image metadata (up to 5) |
| `brief` | The submitted brief text |
| `inferredCategory` | `{key, value, confidence, source}` — null if AI not yet available |
| `inferredAttributes` | Array of inferred attributes from filename, rules, or AI |
| `qualityRisks` | Array of quality risk findings |
| `blockingReasons` | Array of human-readable blocking reason strings |
| `canProceed` | True if no blockers |

## Storage

Step 0 data is stored across three tables:

- **`step0_ingestions`** — one row per project, upserted on each submission
- **`step0_ingestion_images`** — additional and reference images linked to the ingestion
- **`validation_records`** — individual validation rule results

Main images and additional/reference images are stored as `assets` with their SHA-256 checksums.

## Operational Runbook

### Monitoring Step 0

Operators should watch:
- Ingestion status (`pending`, `analyzed`, `blocked`)
- Blocking reason codes on failed ingestions
- Queue depth if analysis is asynchronous
- `can_proceed` flag on the ingestion record

### Image Management

Additional and reference images can be uploaded after the initial ingestion:
1. POST additional images with `ingestionId` — max 20 at once
2. POST reference images with `ingestionId` — max 5 at once
3. Images can be unlinked individually

### Failure Scenarios

| Failure | Action |
|--|--|
| Validation failure | Fix the input (image size, format, missing fields) and resubmit |
| Analysis failure | The ingestion record stays — re-run analysis on the same input version |
| Queue backlog | Check queue depth and oldest job age; scale workers if needed |

### Force Approval

If an operator needs to override a blocked ingestion, they can submit a force approval (`force: true`). This should be logged and traced.

## Smoke Check

1. Submit a valid brief with one main image.
2. Confirm validation passes (no blocking codes).
3. Confirm the ingestion record is created with `status = 'analyzed'` and `can_proceed = true`.
4. Upload one additional image and confirm it is linked.
5. Trigger a force-approval on a blocked ingestion and confirm the block is overridden.
