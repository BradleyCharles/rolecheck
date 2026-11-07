# Accuracy principles

Non-negotiable rules for the whole project. Reference them in code reviews.

1. **Never report "pass" without proof.** If a probe errors, times out, or a table has no rows to
   test against, the result is `UNVERIFIED`, never `PASS`.
2. **Two independent dynamic oracles.** Every access claim is tested through the HTTP API and
   through direct SQL impersonation. Agreement is required for a confident verdict.
3. **Static checks predict, dynamic checks prove.** A static-only finding is `SUSPECTED`, never
   `CONFIRMED`.
4. **Every finding carries evidence.** Request, response, role, row identity, tool version, spec
   hash, schema hash, timestamp, and a reproduction command.
5. **Ground truth exists before the tool does.** The lab app and its expected-findings manifest are
   written first, so the tool is measured against answers fixed in advance.
6. **Determinism.** Same inputs produce byte-identical normalized output, verified by repeated runs.
7. **Cross-tool corroboration.** Where an established tool (splinter, gitleaks, npm audit/OSV)
   covers the same ground, results are compared and every disagreement is explained.
8. **Errors are loud.** Exit code 0 means clean, 1 means findings at or above threshold, 2 means
   the tool itself failed. A crash can never look like a clean scan.
9. **Safe by default.** Write probes only run against local targets unless explicitly overridden.
   The tool never needs production credentials.
