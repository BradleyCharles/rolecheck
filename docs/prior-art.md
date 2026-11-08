# Prior art

Hands-on notes from running existing tools. Sample project names are generalized on purpose.

| Tool                                 | Status                                             |
| ------------------------------------ | -------------------------------------------------- |
| Supabase Security Advisor / splinter | Run 2026-11-07 on one of the author's own projects |
| Lintel                               | TODO                                               |
| Semgrep / gitleaks                   | TODO (gitleaks is covered in Phase 6)              |

## Supabase Security Advisor / splinter

**Run:** 2026-11-07, Dashboard Security Advisor, on a small multiplayer quiz-game project owned by the author.
Result: 0 errors, 13 warnings, 0 info.

| Lint                           | Count | What it flagged                                                                          |
| ------------------------------ | ----- | ---------------------------------------------------------------------------------------- |
| `rls_policy_always_true`       | 12    | INSERT/UPDATE/DELETE policies with `WITH CHECK (true)` or `USING (true)` across 5 tables |
| `function_search_path_mutable` | 1     | A `public` function with no fixed `search_path`                                          |

**Observations**

- **Static only.** Every result is derived from policy text. It says a policy is permissive, never what
  a given role can actually do. rolecheck's two dynamic oracles answer that second question.
- **Intent is invisible.** Several flagged policies have `service` in their names but apply to all
  roles (`roles: ["-"]`, i.e. `public`). splinter cannot tell "meant for the service role only" from
  "intentionally open". A declared access spec can: this is the gap rolecheck fills.
- **Severity is WARN, not ERROR,** even for unrestricted anon writes. A team skimming the dashboard
  could reasonably defer all 13.
- **SELECT is excluded by design.** splinter's description says `USING (true)` on SELECT is skipped
  because it is often deliberate. Cross-tenant reads are therefore not flagged by this lint, so
  rolecheck needs its own read check (seeded flaw V03).
- **Same finding repeated per policy/command.** 12 rows for what is really about 5 tables. rolecheck
  should group by table and operation in reports.
- **Useful output fields:** `name`, `metadata` (schema, table, policy name, command, roles,
  qual, with_check) and `cache_key`. The `metadata` JSON is stable enough to map onto rolecheck
  findings in Phase 6 reconciliation.

**Not yet answered:** what splinter misses on this project. That needs a manual check of the same
schema (for example anon reads and ownership-column reassignment). Revisit after Phase 1, using the
lab, where the expected findings are known in advance.

## Lintel

TODO: read its README, run it on a sample project, and record what it caught and missed.
Do not fill in flags or behavior from memory.
