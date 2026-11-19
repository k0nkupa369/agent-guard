# Agent Guard eval

Run `npm run eval` to replay the bundled scenarios and regenerate this report.

| Scenario | Expected outcome | Actual outcome | Recovered |
| --- | --- | --- | --- |
| baseline/default | VERIFIED DELIVERY (exit 0) | VERIFIED DELIVERY (exit 0) | no |
| baseline/simulate-no-delivery | BROKEN BASELINE (exit 1) | BROKEN BASELINE (exit 1) | no |
| conversion/valid | EDIT ACCEPTED (exit 0) | EDIT ACCEPTED (exit 0) | no |
| conversion/broken-baseline | BROKEN BASELINE (exit 1) | BROKEN BASELINE (exit 1) | no |
| conversion/broken-edit | EDIT REJECTED — RECOVERY VERIFIED (exit 2) | EDIT REJECTED — RECOVERY VERIFIED (exit 2) | yes |
| conversion/failed-recovery | EDIT REJECTED — RECOVERY FAILED (exit 3) | EDIT REJECTED — RECOVERY FAILED (exit 3) | no |
| conversion/invalid | INVALID PROPOSAL (exit 4) | INVALID PROPOSAL (exit 4) | no |
| demo/valid | EDIT ACCEPTED (exit 0) | EDIT ACCEPTED (exit 0) | no |
| demo/broken-baseline | BROKEN BASELINE (exit 1) | BROKEN BASELINE (exit 1) | no |
| demo/broken-edit | EDIT REJECTED — RECOVERY VERIFIED (exit 2) | EDIT REJECTED — RECOVERY VERIFIED (exit 2) | yes |
| demo/failed-recovery | EDIT REJECTED — RECOVERY FAILED (exit 3) | EDIT REJECTED — RECOVERY FAILED (exit 3) | no |
| redirect/valid | EDIT ACCEPTED (exit 0) | EDIT ACCEPTED (exit 0) | no |
| redirect/broken-baseline | BROKEN BASELINE (exit 1) | BROKEN BASELINE (exit 1) | no |
| redirect/broken-edit | EDIT REJECTED — RECOVERY VERIFIED (exit 2) | EDIT REJECTED — RECOVERY VERIFIED (exit 2) | yes |
| redirect/failed-recovery | EDIT REJECTED — RECOVERY FAILED (exit 3) | EDIT REJECTED — RECOVERY FAILED (exit 3) | no |
| redirect/invalid | INVALID PROPOSAL (exit 4) | INVALID PROPOSAL (exit 4) | no |
| webhook/valid | EDIT ACCEPTED (exit 0) | EDIT ACCEPTED (exit 0) | no |
| webhook/broken-baseline | BROKEN BASELINE (exit 1) | BROKEN BASELINE (exit 1) | no |
| webhook/broken-edit | EDIT REJECTED — RECOVERY VERIFIED (exit 2) | EDIT REJECTED — RECOVERY VERIFIED (exit 2) | yes |
| webhook/failed-recovery | EDIT REJECTED — RECOVERY FAILED (exit 3) | EDIT REJECTED — RECOVERY FAILED (exit 3) | no |
| webhook/invalid | INVALID PROPOSAL (exit 4) | INVALID PROPOSAL (exit 4) | no |
| webhook/suppress-distinct | EDIT REJECTED — RECOVERY VERIFIED (exit 2) | EDIT REJECTED — RECOVERY VERIFIED (exit 2) | yes |

## Recorded live run

The saved run used `gpt-6-luna` and reported **EDIT ACCEPTED**. Eval reads the [saved report](live-run.json) without calling the provider.

| Stage | Reference | Matching email |
| --- | --- | --- |
| baseline | `bca2f805-581d-454c-b937-d35ce03583a1` | yes |
| with-company | `b1a89aa4-e237-41c7-bde6-0b268cfab400` | yes |
| without-company | `79d240f8-dc61-47fc-b0a5-8a04c7af850b` | yes |
