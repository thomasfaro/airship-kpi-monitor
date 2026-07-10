# Industry benchmarks

Market benchmark reference used by the skill to position a client's push/app KPIs
against its industry peers (SKILL.md Step 3d + canvas "Benchmark" section).

## Files
- `benchmarks.json` — machine-readable source the skill reads at runtime.
- `benchmarks.md` — human-readable rendering of the same data (per-vertical tables).
- `../scripts/import_benchmarks.py` — regenerates both files from a quarterly xlsx.

## Provenance
- Source: **Airship User Engagement (UA) Benchmarks** workbook.
- Current import: `Q2_2026_UA_Benchmarks_07.09.2026.xlsx`, published **2026-Q2**,
  region **global** (no region/locale split).
- This reference data is **non-secret** and is committed to the repo. It contains
  no client data.

## Scope
Benchmarked metrics (push/app only — the workbook has **no email/SMS** benchmark):
- `optin_rate`, `direct_open_rate`, `influenced_open_rate`,
  `sends_per_user_month` — split by **device family** (`ios` / `android` / `web`).
- `message_center_read_rate` — **vertical-only** (no device split).

Percentile bands follow the workbook's Overview legend:
**Low = p10 (10th)**, **Medium = p50 (median)**, **High = p90 (90th)**.

## Verticals
`all_verticals`, `business`, `charities_foundations_and_non_profit`, `education`,
`entertainment`, `finance_insurance`, `food_drink`, `gambling_gaming`,
`government`, `media`, `medical_health_fitness`, `retail`, `social`,
`sports_recreation`, `travel_transportation`, `utility_productivity`.

Each vertical carries `aliases` so a client's `industry` (in `clients.yml`) maps to
the right vertical (e.g. telecom → `utility_productivity`; bank/insurance →
`finance_insurance`). If no vertical matches, the skill states "benchmark not
available" rather than forcing a mismatched one.

## Refreshing each quarter
```bash
cd .cursor/skills/airship-kpi-monitor
python scripts/import_benchmarks.py /path/to/Qx_YYYY_UA_Benchmarks.xlsx
```
Writes `benchmarks/benchmarks.json` and `benchmarks/benchmarks.md`. Commit both.

## Usage notes
- Compare **per device family** — never blend platforms against a per-platform band.
- `sends_per_user_month` is **per MONTH**: multiply a weekly client pressure by
  ~4.33 (or recompute monthly) before comparing.
- Always cite source + quarter + region beside a comparison; benchmark-based
  insights are capped at **Medium** confidence (external/contextual).

Credit: `benchmarks.json`, `import_benchmarks.py` and `classify_campaigns.py` are
shared with the `airship-engagement-review` skill.
