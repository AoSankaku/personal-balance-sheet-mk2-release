# Depreciation preview performance evidence

The preview read cache and range query were measured against the same in-memory fixture with Bun 1.3.14. The unoptimized route was loaded from commit `2c51c97`; the optimized route ran against the same database state. Both returned HTTP 200 and their complete JSON bodies were byte-for-byte identical.

| Method | Accounting months | Reset boundaries | Baseline D1 calls | Optimized D1 calls | Reduction | Full JSON SHA-256 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| assigned | 30 | 6 | 431 | 73 | 83.1% | `393fab1ef261d0002f44da39a8d30f26bd41ba506712f2c0f8f605b52815efd0` |
| special | 30 | 6 | 515 | 73 | 85.8% | `951621e7b0e878b34fc708d8b90b24184bdce4f0c3f5e11efe79771b2fdcfd03` |
| special | 120 | 24 | 1,819 | 171 | 90.6% | `da2807132451ead49d5d398768462bb6b4309d06464f00e68ea0ec1a0d23bfbe` |

The JSON body sizes were 14,481, 15,836, and 56,677 bytes respectively. The hashes include the full preview payload, including its token and timeline, for the local date `2026-10-19`.

The final 30-month/6-reset run repeated three times at zero artificial latency used 73 D1 calls each. One run with 5 ms added to each D1 call completed in approximately 1.07 seconds locally. The earlier 515-call baseline took approximately 4.85 seconds under the same artificial latency. These timings are a local latency simulation, not a production service-level measurement.

Reproduce the optimized measurements from the repository root (isolated synthetic data only):

```powershell
bun worker/tests/helpers/benchmarkDepreciationBudgetPreview.ts special 30 6 0 3
bun worker/tests/helpers/benchmarkDepreciationBudgetPreview.ts special 30 6 5 1
bun worker/tests/helpers/benchmarkDepreciationBudgetPreview.ts special 120 24 5 1
```

The arguments are method, accounting months, reset count, artificial latency in milliseconds, and repetitions. `ENFORCE_D1_PARAMETERS=1` also enables the test driver's 100-parameter ceiling. The benchmark always uses a fresh in-memory database and does not access real D1 data.

`depreciationBudgetPreviewPerformance.test.ts` keeps a read-count gate requiring under 130 SELECTs for the 30-month assigned fixture (431 baseline SELECTs), complete same-request response comparison, cross-request freshness check, revision race check, 100-parameter history test, and malformed month-key behavior check. `d1ReadMemo.test.ts` checks in-flight sharing, cloned result isolation, typed parameter and operation key distinctions, and revision-query bypass.
