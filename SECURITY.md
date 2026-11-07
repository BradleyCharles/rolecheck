# Security Policy

rolecheck is a security tool that handles test credentials, performs write probes against
local databases, and renders attacker-controlled data (row contents) in HTML reports.
Vulnerabilities in the tool itself matter.

## Reporting a vulnerability

Please report privately using GitHub's
[private vulnerability reporting](https://github.com/BradleyCharles/rolecheck/security/advisories/new).
Do not open a public issue for security problems.

Include the rolecheck version, steps to reproduce, and the impact you expect. You can expect an
acknowledgement within 7 days.

## Scope

In scope: credential leakage in reports or logs, write probes reaching non-local targets without
explicit confirmation, XSS or injection in generated reports, command injection in the GitHub
Action, and incorrect `PASS` results caused by tool errors.

Out of scope: vulnerabilities in the intentionally vulnerable apps under `lab/`.
