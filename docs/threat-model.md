# Threat model (the tool itself)

## Assets

- Test-user credentials and tokens obtained during sign-in
- Local Supabase secret key (bypasses RLS)
- The target's schema, policies, and row data, which appear in evidence records
- The integrity of verdicts: a false `PASS` is the worst failure

## Threats and mitigations

| Threat                                           | Mitigation                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Write probes run against production              | Writes refused unless host is `127.0.0.1`/`localhost`, or `--allow-remote-writes` plus matching `--confirm-target <project-ref>` |
| Secrets leak into reports, logs, or CI artifacts | Redact tokens and keys in every evidence record; repro commands use placeholders                                                 |
| Row contents carry XSS into the HTML report      | HTML-escape all data; strict CSP meta tag; lab row V18 is a regression test                                                      |
| Malicious spec or migration executes code        | Spec is data only (zod-validated); scope predicates run only in rolled-back or read-only contexts on a local DB                  |
| GitHub Action input injection                    | Inputs pass through `env:`, never interpolated into `run:`                                                                       |
| Tool crash reads as a clean scan                 | Exit code 2 for tool failure; `UNVERIFIED` on any probe error                                                                    |
| Canary rows left behind                          | Run-ID tagging, privileged cleanup, verified zero remaining; failure fails the run                                               |
| Supply chain (deps, actions)                     | Dependabot, pinned action SHAs, npm provenance, minimal dependency set                                                           |

## Out of scope

Attacks on the user's Supabase project from outside rolecheck; hosted/production scanning.
