# Test plan (record actual results after running)

| Case | Expected | Actual |
|---|---|---|
| Public health | 200 success | Not executed against your environment |
| Customer registers and logs in | session token | Not executed |
| Customer token on admin | 403 | Not executed |
| No bearer token on admin | 401 | Not executed |
| Negative quantity | 422 | Not executed |
| Buy last unit concurrently twice | one success, one conflict | Not executed |
| Duplicate checkout key | same order | Not executed |
| Fake Maya signature | 401, no payment | Not executed |
| Signed Maya success + correct amount | paid exactly once | Not executed |
| Mismatched PHP amount | payment_review, not paid | Not executed |
| Missed webhook | admin/customer reconcile recovers | Not executed |
| Deliver purchased watch | warranty created | Not executed |

**Warning**: This is a test PLAN, not claimed passing evidence. Complete using your real test environment.
