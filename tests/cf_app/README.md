# CardFlow API Test Suite

Automated QA tests for the CardFlow staging pipeline.

## Coverage Areas
- **test_ingestion** — Step 0 upload, analysis, gating (blocked by `315e67b1`)
- **test_engine** — Stage transitions, approve/comment/regenerate, batch final, recovery (blocked by `179ad31e`)
- **test_compliance** — WB/Ozon rules, export blocking, review flows (blocked by `3f40bd18`)
- **test_versioning** — Immutable revisions, branching, provenance (blocked by `90473fae`)

## Setup
```bash
cd ...  # run from project root once app code lands
pip install -r tests/cf_app/requirements.txt
pytest tests/cf_app/ --tb=short
```

## Config
Set `CF_BASE_URL` and `CF_AUTH_TOKEN` env vars to point at the running CardFlow app.

## Status
**DRAFT** — All tests have placeholder assertions (`pytest.skip("upstream task not landed yet")`).
Once the upstream dev task is complete, fill in `CARDFLOW_ENDPOINTS` in `conftest.py` and remove the skips.
