# rolecheck: Project Roadmap

**Working name:** `rolecheck` (placeholder; check npm and GitHub for name availability before Phase 9)
**What it is:** A CLI and GitHub Action that verifies a Next.js + Supabase app's access control against a declared spec, using multiple independent methods so every result is backed by evidence.
**Pace:** 20+ hours per week, about 14 weeks (roughly 280 to 320 hours)
**Test targets:** A purpose-built vulnerable lab app, its fixed twin, Next Wave Dev (NWD), and your other Next.js + Supabase projects

> Version numbers, CLI flags, and action tags in this document were checked in November 2026. Tools change, so confirm against each tool's own docs when you reach that phase. Every place this matters is marked **[verify]**.

---

## Table of contents

1. Project summary and positioning
2. Accuracy principles
3. Architecture
4. Phase plan
5. Accuracy and redundancy framework
6. GitHub Actions guide (from zero)
7. Testing against your own projects
8. Repository layout
9. Risks and mitigations
10. Launch checklist
11. Appendices: spec example, evidence bundle, seeded flaw catalogue, verdict table

---

## 1. Project summary and positioning

### The problem
Supabase apps enforce authorization in Postgres Row Level Security (RLS), while Next.js apps add a second layer in proxy/middleware, route handlers, and server actions. Bugs live in the gaps: a UI route guard that hides a page while the underlying table is readable with the public key, or an update policy that lets a user reassign a row to someone else.

### What rolecheck does
1. You declare intended access in a YAML spec: which roles can do which operations on which rows.
2. rolecheck signs in as real test users for each role and attempts every operation against every table, through the same API an attacker would use.
3. It independently re-checks the same access at the SQL level inside rolled-back transactions.
4. It runs a small set of static checks for things probing cannot see (leaked keys, unprotected routes).
5. It compares all results, assigns a confidence level, and produces an evidence-backed report.

### Prior art (acknowledge this in your README)
| Tool | What it does | How rolecheck differs |
|---|---|---|
| Supabase Security Advisor / splinter | SQL lints for schema issues (RLS disabled, security definer views, user_metadata in policies) | Static only; rolecheck uses splinter as a corroborating source, not a competitor |
| Lintel | Builds the DB from migrations and proves what the anon key can read | rolecheck tests multiple app-level roles, row-level ownership, writes, and cross-tenant access against a declared spec |
| Semgrep, gitleaks | Code patterns and secret scanning | General purpose; rolecheck adds Supabase-specific key and auth checks and cross-references gitleaks |

**Positioning statement:** "rolecheck verifies that every role in your Supabase app can do exactly what your access spec says and nothing more, using two independent dynamic methods and recording the evidence for every result."

### Platform facts that shape the design
- **Supabase API keys:** Legacy `anon` and `service_role` JWT keys are being deprecated by the end of 2026 in favor of `sb_publishable_...` and `sb_secret_...` keys. rolecheck must support both generations. The secret key and legacy service_role key map to the `service_role` Postgres role, which bypasses RLS. **[verify]**
- **Grants before RLS:** Postgres checks table grants first, then RLS. A "denied by grant" result and a "filtered by RLS" result look different and must be recorded differently.
- **Next.js 16:** `middleware.ts` was renamed to `proxy.ts` (exported function `proxy`), runs on the Node.js runtime, and the old name is deprecated but still works. rolecheck must detect both files. **[verify]**
- **Server-side auth:** `getSession()` reads the session from cookies without verifying it and must not gate access on the server. `getClaims()` verifies the JWT signature; `getUser()` calls the Auth server and is authoritative. **[verify]**

---

## 2. Accuracy principles

These are non-negotiable rules for the whole project. Put them in `docs/accuracy.md` and reference them in code reviews.

1. **Never report "pass" without proof.** If a probe errors, times out, or a table has no rows to test against, the result is `UNVERIFIED`, never `PASS`.
2. **Two independent dynamic oracles.** Every access claim is tested through the HTTP API and through direct SQL impersonation. Agreement is required for a confident verdict.
3. **Static checks predict, dynamic checks prove.** A static-only finding is labeled `SUSPECTED`, never `CONFIRMED`.
4. **Every finding carries evidence.** Request, response, role, row identity, tool version, spec hash, schema hash, timestamp, and a reproduction command.
5. **Ground truth exists before the tool does.** The lab app and its expected-findings manifest are written first, so the tool is measured against answers you fixed in advance.
6. **Determinism.** Same inputs produce byte-identical normalized output. Verified by repeated runs.
7. **Cross-tool corroboration.** Where an established tool (splinter, gitleaks, npm audit/OSV) covers the same ground, results are compared and every disagreement is explained.
8. **Errors are loud.** Exit code 0 means clean, 1 means findings at or above threshold, 2 means the tool itself failed. A crash can never look like a clean scan.
9. **Safe by default.** Write probes only run against local targets unless explicitly overridden. The tool never needs production credentials.

---

## 3. Architecture

```
                 +------------------+
  access-spec -->|  Spec loader     |  (zod validation, JSON Schema export)
  fixtures    -->|  + Fixture seeder|  (creates test users, roles, seed rows)
                 +--------+---------+
                          |
        +-----------------+------------------+
        |                 |                  |
+-------v------+  +-------v-------+  +-------v--------+
| Oracle A     |  | Oracle B      |  | Static checks  |
| HTTP probe   |  | SQL imperson. |  | DB lints, keys,|
| (PostgREST,  |  | (rolled-back  |  | Next.js code   |
|  Storage,RPC)|  |  transactions)|  | + splinter,    |
+-------+------+  +-------+-------+  |   gitleaks xref|
        |                 |          +-------+--------+
        +--------+--------+                  |
                 |                           |
          +------v---------------------------v-----+
          |  Verdict engine                         |
          |  (compare oracles, assign confidence)   |
          +------------------+----------------------+
                             |
          +------------------v----------------------+
          |  Reporters: JSON (canonical), SARIF,    |
          |  HTML (matrix + evidence), console      |
          +-----------------------------------------+
```

### Tech stack
| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript, Node 26 (Active LTS), CI also tests Node 24 | Longest support window; 24 is still common among users |
| CLI framework | `commander` | Mature, well documented |
| Spec validation | `zod` (+ `zod-to-json-schema` for editor autocomplete) | Typed, good errors |
| Auth for test users | `@supabase/supabase-js` | Real sign-in flow |
| HTTP probing | Native `fetch` with raw PostgREST requests | Full control over headers; evidence matches exactly what was sent |
| SQL oracle | `pg` (node-postgres) | Direct transactions with `set local role` |
| SQL parsing | `pgsql-parser` (libpg_query) | Real Postgres parser, not regex |
| Code analysis | `ts-morph` | TypeScript AST for Next.js checks |
| Tests | `vitest` | Fast, TS native |
| Local Supabase | Supabase CLI (`supabase start`) via Docker | Same stack locally and in CI |
| HTML report | Single self-contained HTML file (inline CSS/JS) | Works as a CI artifact |

---

## 4. Phase plan

Each phase has tasks, a deliverable, and **exit criteria**. Do not start the next phase until exit criteria are met.

### Phase 0: Groundwork (Week 1, ~20 hrs)

**Environment**
- [ ] Install Docker Engine on Nobara from Docker's Fedora repo (native DNF, not Flatpak). Follow Docker's "Install Docker Engine on Fedora" page **[verify]**, then `sudo systemctl enable --now docker` and add yourself to the `docker` group (log out and back in).
- [ ] Confirm: `docker run hello-world`
- [ ] Node 26 installed for development (`.nvmrc` = 26); Node 24 also installed for local cross-checks; `node -v`
- [ ] Supabase CLI as a project dev dependency: `npm i -D supabase`, then `npx supabase --version`
- [ ] Podman note: Supabase CLI expects the Docker API. Use Docker Engine to avoid compatibility issues.

**Repository**
- [ ] Create public GitHub repo `rolecheck` with MIT or Apache-2.0 license, `.gitignore` (Node), `README.md` stub
- [ ] Turn on in repo Settings: Dependabot alerts, secret scanning, push protection
- [ ] Add `SECURITY.md` (how to report vulnerabilities in the tool itself)
- [ ] Scaffold TypeScript project: `tsconfig.json` (strict), eslint, prettier, vitest, `npm run lint|typecheck|test|build` scripts
- [ ] Complete **GitHub Actions Exercise 1 and Workflow 1** (Section 6) so CI exists from day one

**Permissions**
- [ ] Get written approval from NWD teammates and owners of every other target project (template in Section 7)

**Design docs**
- [ ] `docs/accuracy.md` (Section 2 rules)
- [ ] `docs/threat-model.md` for the tool itself: it handles test credentials, makes writes, and renders attacker-controlled data (row contents) in HTML
- [ ] `docs/prior-art.md` with your own hands-on notes after running splinter and Lintel on a sample project

**Exit criteria:** CI runs green on an empty test; Docker and Supabase CLI work locally; approvals obtained in writing.

---

### Phase 1: The vulnerable lab and its fixed twin (Weeks 1 to 2, ~30 hrs)

The lab is your ground truth. Build it before the scanner.

- [ ] Create `lab/vulnerable/`: a minimal Next.js 16 + Supabase app modeling a client portal with three roles (admin, client, contractor) and tables: `profiles`, `projects`, `project_members`, `invoices`, `messages`
- [ ] Store roles in `app_metadata` (correct) or a `profiles.role` column; use the same approach NWD uses so the lab is representative
- [ ] Write migrations under `lab/vulnerable/supabase/migrations/` containing every seeded flaw in Appendix C
- [ ] `seed.sql` with rows owned by each test user, so every row class (own, peer, foreign) has at least two rows per table
- [ ] Copy to `lab/fixed/` and correct every flaw
- [ ] Write `lab/vulnerable/ground-truth.yaml`: one entry per flaw with ID, table/file, role, operation, row class, and expected verdict
- [ ] Write `lab/fixed/ground-truth.yaml`: expected verdict for every cell is `PASS`
- [ ] Manually verify each seeded flaw with `curl` or a short script, and record the commands in `lab/vulnerable/MANUAL-VERIFICATION.md`. This proves the ground truth is real before the tool exists.
- [ ] README warning: the lab is intentionally vulnerable and must never be deployed publicly

**Exit criteria:** `npx supabase start` and `npx supabase db reset` work in both labs; every flaw manually reproduced and documented.

---

### Phase 2: Spec format, fixtures, and starter generator (Week 3, ~20 hrs)

- [ ] Define the spec schema in zod (example in Appendix A). Core concepts:
  - **roles:** named app roles mapped to test users
  - **scopes:** named SQL predicates using `:uid` that define which rows a role should reach (`own`, `assigned`, `all`, `none`)
  - **tables:** per role, per operation (`select`, `insert`, `update`, `delete`), which scope is allowed
  - **storage** buckets and **rpc** functions, same structure
- [ ] Export JSON Schema so VS Code autocompletes the YAML
- [ ] Fixture seeder: creates test users through the Auth admin API using the **local** secret key only, assigns roles, records user IDs to `.rolecheck/fixtures.json`
- [ ] `rolecheck init`: introspects the local DB (`information_schema`, `pg_policies`, `pg_class.relrowsecurity`) and writes a starter spec with every table set to `none` and comments listing detected policies. Users then loosen it deliberately. Deny-by-default prevents accidental "expected" leaks.
- [ ] `rolecheck validate`: validates the spec and checks every scope predicate compiles against the DB
- [ ] Unit tests for every schema rule, including invalid specs

**Exit criteria:** Specs for both labs validate; seeder creates users idempotently; `init` output reviewed by hand against the schema.

---

### Phase 3: Oracle A, the HTTP probe (Weeks 4 to 5, ~45 hrs)

This is the attacker's view: real sign-ins, real API calls.

**Target connection**
- [ ] Read URL and keys from `npx supabase status -o json` (run it locally first and note the exact field names for your CLI version **[verify]**). Support both publishable and legacy anon keys.
- [ ] Refuse to run write probes unless the URL is `127.0.0.1`/`localhost`, or `--allow-remote-writes` plus a matching `--confirm-target <project-ref>` is given

**Expected row sets**
- [ ] For each role user and table, compute the expected row IDs by evaluating the scope predicate with the privileged DB connection. This is the comparison baseline.

**Read probes**
- [ ] `GET /rest/v1/<table>?select=<pk>` with header `Prefer: count=exact`, signed in as each test user (and as anon)
- [ ] Compare returned IDs with expected IDs. Classify: `EXACT`, `OVER` (saw rows it should not: violation), `UNDER` (missing rows it should see: functional bug, lower severity)

**Write probes (local only by default)**
- [ ] Insert: attempt to insert a canary row into each row class (owned by self, peer, foreign). Record HTTP status and Postgres error code. Note that RLS insert rejections arrive as errors, while blocked updates/deletes often return success with zero rows affected, so always use `Prefer: return=representation` and count affected rows **[verify against PostgREST docs]**
- [ ] Update: attempt to modify a non-key column on rows of each class; separately attempt to change the ownership column (catches missing `WITH CHECK`)
- [ ] Delete: attempt on canary rows only, never on seed rows
- [ ] Tag every canary row with a run ID; cleanup step deletes them with the privileged connection and verifies zero remain (cleanup failure fails the run)
- [ ] `npx supabase db reset` between full runs in CI for a clean baseline

**Escalation probes**
- [ ] As a non-admin user, call `auth.updateUser({ data: { role: 'admin' } })`, refresh the session, and re-run reads. Detects policies trusting `user_metadata`.

**Storage and RPC**
- [ ] Storage: list and download objects in each bucket per role; upload to paths owned by other users
- [ ] RPC: call each exposed function per role, including anon

**Evidence**
- [ ] Every probe writes an evidence record (Appendix B) with secrets redacted and a reproduction `curl` command using placeholder tokens

**Exit criteria:** Oracle A detects every dynamic flaw in the vulnerable lab and reports zero violations on the fixed lab; results identical across 3 consecutive runs.

---

### Phase 4: Oracle B, SQL impersonation, and the verdict engine (Week 6, ~25 hrs)

This is the database's view, computed independently of PostgREST.

- [ ] For each probe, open a transaction, then:
  ```sql
  begin;
  set local role authenticated;  -- or anon
  select set_config('request.jwt.claims', '<claims json for this user>', true);
  -- run the equivalent select/insert/update/delete
  rollback;
  ```
  Because everything rolls back, Oracle B is safe even for write tests. **[verify how auth.uid() reads claims in your Supabase version]**
- [ ] Build claims JSON that matches what Supabase Auth issues (`sub`, `role`, `app_metadata`, `user_metadata`). Fetch a real token from Oracle A's sign-in, decode it, and use its exact claims so both oracles test the same identity.
- [ ] Compare Oracle A and Oracle B per cell using the verdict table (Appendix D)
- [ ] Disagreements become `INCONCLUSIVE` findings with both evidence records attached. Common legitimate causes to document: schema not exposed through the API, column-level grants, views, PostgREST config.
- [ ] Optional stretch: export Oracle B checks as pgTAP tests runnable with `supabase test db`, giving users a third, standard way to re-verify

**Exit criteria:** On both labs, Oracle A and Oracle B agree on 100% of cells. Any disagreement is investigated and either fixed or documented.

---

### Phase 5: Benchmark in CI (Week 7, ~15 hrs)

- [ ] `rolecheck benchmark --results <dir> --expected ground-truth.yaml`: compares a run against ground truth, prints a confusion matrix (true/false positives and negatives per flaw ID), exits non-zero on any mismatch
- [ ] Complete **Workflow 2** (Section 6): every pull request rebuilds both labs and runs the benchmark
- [ ] Add branch protection so the benchmark must pass before merging

**Exit criteria:** A PR that breaks detection of any seeded flaw is blocked automatically.

---

### Phase 6: Static checks and cross-tool corroboration (Weeks 8 to 9, ~35 hrs)

Keep this small and high value. Every static finding is `SUSPECTED` unless a dynamic oracle confirms it.

**Database (from live introspection, cross-checked with parsed migrations)**
- [ ] RLS disabled on tables in exposed schemas
- [ ] RLS enabled with no policies (usually a functional bug, severity info)
- [ ] Policies with `using (true)` or missing `with check` on insert/update
- [ ] Policies referencing `user_metadata`
- [ ] `security definer` views and functions in exposed schemas
- [ ] Broad grants to `anon` / `authenticated`
- [ ] **Corroboration:** run splinter's `splinter.sql` against the same DB and map its security lints to yours. Every lint must either match a rolecheck finding or be explained in the report. Note: locally you may need to `set local pgrst.db_schemas = 'public, storage'` before running it, or results can come back empty **[verify]**

**Keys and secrets**
- [ ] Detect `sb_secret_` keys, and legacy JWTs whose decoded `role` claim is `service_role`, in: source, `.env*` files, `NEXT_PUBLIC_*` variables, built client bundles (`.next/static`), and git history
- [ ] Detect Supabase personal access tokens (`sbp_` prefix) **[verify]**
- [ ] **Corroboration:** run gitleaks on the same repo and reconcile results

**Next.js app layer (ts-morph)**
- [ ] Find `proxy.ts` or `middleware.ts`, parse the `matcher`, list every route under `app/`, and report protected-looking routes (e.g. `/admin`, `/api/admin`) the matcher does not cover
- [ ] Server actions and route handlers that write data with no `getClaims()` / `getUser()` call
- [ ] `getSession()` used for authorization decisions in server code
- [ ] Next.js version check via the OSV or GitHub Advisory database (not a hardcoded list), with CVE-2025-29927 (middleware authorization bypass) as a fixture case
- [ ] Missing security headers (CSP, HSTS, frame-ancestors) in `next.config` headers

**Exit criteria:** Every static flaw in Appendix C detected in the vulnerable lab, zero in the fixed lab, all splinter and gitleaks results reconciled.

---

### Phase 7: Reporting (Weeks 9 to 10, ~30 hrs)

- [ ] **JSON (canonical):** stable key order, sorted findings, normalized timestamps excluded from the hash, so two runs can be diffed and hashed
- [ ] **SARIF 2.1.0:** validated against the official SARIF JSON schema in tests; findings mapped to file/line where possible (migration file for policies, source file for code)
- [ ] **HTML:** single self-contained file
  - Role x table x operation matrix, expected vs actual, color plus icon/text for each state (never color alone)
  - Click a cell to see both oracles' evidence side by side
  - Suggested fix as SQL for policy findings
  - All row data HTML-escaped; strict CSP meta tag in the report (row contents are attacker-controlled)
- [ ] **Console:** summary table and exit code
- [ ] Snapshot tests for all reporters against the lab results

**Exit criteria:** Reports open cleanly from a CI artifact; SARIF uploads to GitHub code scanning without errors; XSS test row in the lab renders as text.

---

### Phase 8: Accuracy validation (Weeks 10 to 11, ~30 hrs)

- [ ] **Mutation testing:** script that takes the fixed lab and generates mutants, one weakness each:
  - replace a policy predicate with `true`
  - drop `with check`
  - disable RLS on one table
  - change `to authenticated` to `to anon`
  - swap the ownership column in a predicate
  - add `user_metadata` to an admin check
  Apply each mutant, run rolecheck, record whether it was detected. Target 90%+ detection; every surviving mutant gets a written explanation or a fix.
- [ ] **Determinism:** run full scan 3 times with `db reset` between; normalized JSON hashes must match
- [ ] **Metrics page:** `docs/accuracy-results.md` with recall on seeded flaws, false positives on fixed lab, mutation score, oracle agreement rate, determinism result, splinter/gitleaks reconciliation, tool version and date
- [ ] Add mutation testing as a weekly scheduled workflow (`on: schedule`)

**Exit criteria:** All targets in Section 5 met and published.

---

### Phase 9: Packaging (Week 11, ~15 hrs)

- [ ] Final name chosen and available on npm
- [ ] `package.json` `bin` entry, `files` allowlist (ship only `dist/`)
- [ ] Complete **Workflow 3** (composite action) and **Workflow 4** (npm release with provenance) from Section 6
- [ ] Tag `v0.1.0`, publish, install from npm in a clean directory and run against a lab

**Exit criteria:** `npx rolecheck@0.1.0 scan` works from a fresh machine; the action works from another repo.

---

### Phase 10: Real-world testing (Weeks 12 to 13, ~45 hrs)

Detailed procedure in Section 7.

- [ ] NWD first, then each other project
- [ ] Every finding manually verified and logged
- [ ] Fixes made through each project's normal PR process
- [ ] Re-run after fixes to confirm closure
- [ ] Track false positives found in real code and feed them back as new lab cases and tests

**Exit criteria:** Each project has a completed verification log; every rolecheck false positive or false negative found in the wild has a regression test.

---

### Phase 11: Polish and launch (Week 14, ~25 hrs)

See Section 10 checklist.

---

## 5. Accuracy and redundancy framework

### Layers of redundancy
| Layer | What it guards against |
|---|---|
| Two dynamic oracles (HTTP and SQL) | A bug in one probe engine, PostgREST quirks, misread responses |
| Static checks | Things probes cannot reach (leaked keys, unprotected routes) |
| splinter, gitleaks, OSV cross-checks | Blind spots in your own static rules |
| Ground-truth lab + fixed twin | Measures recall and false positives against fixed answers |
| Mutation testing | Overfitting to the seeded flaws |
| Repeated runs | Nondeterminism, ordering bugs, leftover state |
| Manual verification log | Real-world cases the lab did not anticipate |

### Confidence levels
| Level | Meaning |
|---|---|
| `CONFIRMED` | Both dynamic oracles observed the violation |
| `INCONCLUSIVE` | Oracles disagree; both evidence records attached; needs human review |
| `SUSPECTED` | Static check only, or one oracle could not run |
| `UNVERIFIED` | Not enough data to decide (no rows in a row class, probe error, timeout) |
| `PASS` | Both oracles observed expected behavior with non-empty test data |

### Release gates (must hold for every tagged release)
- 100% recall on seeded flaws with correct flaw IDs
- 0 `CONFIRMED` or `SUSPECTED` findings on the fixed lab
- 100% oracle agreement on both labs
- Mutation detection 90%+ with every survivor explained
- 3/3 identical normalized result hashes
- All splinter and gitleaks results reconciled
- 0 tool errors in benchmark runs

### Manual verification log (for real projects)
For every finding on NWD and other projects, record in `verification-log.md` (kept private if needed):

| Field | Example |
|---|---|
| Finding ID | `RC-0012` |
| rolecheck verdict | CONFIRMED, select OVER, `public.invoices`, role contractor |
| Manual reproduction | curl command run by hand, result |
| Second reviewer | Teammate name, agreed/disagreed |
| Classification | True positive / false positive / spec error |
| Action | Fix PR link, or spec corrected, or tool bug filed |
| Re-test result | PASS after fix on date |

---

## 6. GitHub Actions guide (from zero)

### 6.1 Concepts
| Term | Meaning |
|---|---|
| **Workflow** | A YAML file in `.github/workflows/` describing automation. A repo can have many. |
| **Trigger (`on:`)** | The event that starts a workflow: `push`, `pull_request`, `schedule`, `workflow_dispatch` (manual button), `release` |
| **Job** | A group of steps that runs on one fresh virtual machine. Jobs run in parallel unless one `needs:` another. |
| **Runner** | The machine. `ubuntu-latest` is a GitHub-hosted Linux VM with Docker preinstalled. |
| **Step** | Either `uses:` (run a published action) or `run:` (run shell commands) |
| **Action** | A reusable step published in a repo, referenced as `owner/repo@version` |
| **Secret** | Encrypted value stored in repo settings, read as `${{ secrets.NAME }}` |
| **Permissions** | What the workflow's automatic `GITHUB_TOKEN` may do. Always set the minimum. |
| **Artifact** | A file saved from a run that you can download afterward (your HTML report) |
| **Matrix** | Run the same job several times with different inputs, in parallel |

### 6.2 Exercise 1: Hello world (do this in Phase 0)
1. In your `rolecheck` repo, create the folder path `.github/workflows/`
2. Create `.github/workflows/hello.yml`:
   ```yaml
   name: Hello
   on:
     workflow_dispatch:     # adds a "Run workflow" button
     push:
       branches: [main]
   permissions:
     contents: read
   jobs:
     greet:
       runs-on: ubuntu-latest
       steps:
         - name: Say hello
           run: |
             echo "Hello from $GITHUB_REPOSITORY"
             echo "Commit: $GITHUB_SHA"
             docker --version
   ```
3. Commit and push to `main`
4. Open the repo on GitHub, click the **Actions** tab, click the **Hello** run, click the **greet** job, expand **Say hello** to see the output
5. Click **Run workflow** (top right of the workflow page) to trigger it manually
6. Break it on purpose: change `echo` to `ech`, push, and see how a failure looks. Fix it.
7. Delete `hello.yml` once you are comfortable.

### 6.3 Workflow 1: CI for the tool (Phase 0)
`.github/workflows/ci.yml`
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        node: [24, 26]       # test both supported Node lines
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```
How to check it works: open a pull request; the check appears at the bottom of the PR page with a green check or red X.

### 6.4 Workflow 2: Benchmark against both labs (Phase 5)
`.github/workflows/benchmark.yml`
```yaml
name: Benchmark
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  benchmark:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
      fail-fast: false        # run both labs even if one fails
      matrix:
        lab: [vulnerable, fixed]
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: 26
          cache: npm

      - run: npm ci
      - run: npm run build

      - uses: supabase/setup-cli@v1
        with:
          version: latest     # after it works, pin the exact version you tested

      - name: Start local Supabase
        working-directory: lab/${{ matrix.lab }}
        run: supabase start

      - name: Seed fixtures
        working-directory: lab/${{ matrix.lab }}
        run: node ../../dist/cli.js fixtures --spec access-spec.yaml

      - name: Scan (run 1 of 3)
        working-directory: lab/${{ matrix.lab }}
        run: node ../../dist/cli.js scan --spec access-spec.yaml --out ../../results/${{ matrix.lab }}/run1

      - name: Reset and scan (runs 2 and 3)
        working-directory: lab/${{ matrix.lab }}
        run: |
          for i in 2 3; do
            supabase db reset
            node ../../dist/cli.js fixtures --spec access-spec.yaml
            node ../../dist/cli.js scan --spec access-spec.yaml --out ../../results/${{ matrix.lab }}/run$i
          done

      - name: Check determinism
        run: node dist/cli.js compare-runs results/${{ matrix.lab }}/run1 results/${{ matrix.lab }}/run2 results/${{ matrix.lab }}/run3

      - name: Compare with ground truth
        run: node dist/cli.js benchmark --results results/${{ matrix.lab }}/run1 --expected lab/${{ matrix.lab }}/ground-truth.yaml

      - name: Upload reports
        if: always()          # upload even when a step above failed
        uses: actions/upload-artifact@v5
        with:
          name: report-${{ matrix.lab }}
          path: results/${{ matrix.lab }}/
```
Notes:
- The matrix runs each lab on its own VM, so the two Supabase stacks never fight over ports.
- Keys from a local `supabase start` are well-known local development keys, so no secrets are needed here.
- Find the report: open the run, scroll to **Artifacts**, download `report-vulnerable`.
- `supabase start` downloads several Docker images and can take a few minutes. If it is slow, check `supabase start --help` for an option to exclude services you do not need, such as Studio **[verify]**.

### 6.5 Workflow 3: Publishing rolecheck as an action (Phase 9)
A **composite action** is the simplest kind: it is just a list of steps. Create `action.yml` in the repo root:
```yaml
name: rolecheck
description: Verify Supabase access control against a declared access spec
branding:
  icon: shield
  color: blue
inputs:
  spec:
    description: Path to the access spec
    required: false
    default: rolecheck.yaml
  fail-on:
    description: Minimum confidence that fails the build (confirmed, suspected)
    required: false
    default: confirmed
  version:
    description: rolecheck npm version to run
    required: false
    default: "0.1.0"
runs:
  using: composite
  steps:
    - name: Run rolecheck
      shell: bash
      env:
        RC_SPEC: ${{ inputs.spec }}
        RC_FAIL_ON: ${{ inputs.fail-on }}
        RC_VERSION: ${{ inputs.version }}
      run: |
        npx --yes "rolecheck@${RC_VERSION}" fixtures --spec "$RC_SPEC"
        npx --yes "rolecheck@${RC_VERSION}" scan --spec "$RC_SPEC" \
          --fail-on "$RC_FAIL_ON" --sarif rolecheck.sarif --out rolecheck-report
```
Why inputs go through `env:` instead of directly into `run:`: inserting `${{ inputs.x }}` into a shell script lets a malicious value inject commands. Passing through environment variables avoids that. For a security tool, reviewers will look for this.

To publish: create a GitHub release with a tag like `v0.1.0`. To list it on the Marketplace, tick "Publish this Action to the GitHub Marketplace" on the release form (requires accepting the Marketplace agreement once). Also maintain a moving `v0` tag pointing at the latest `v0.x.y` so users can write `@v0`.

### 6.6 Workflow 4: npm release with provenance (Phase 9)
Use npm **trusted publishing**, which lets GitHub Actions publish without storing a long-lived npm token, and attaches provenance showing the package was built from your repo. Configure the trusted publisher in your package settings on npmjs.com following npm's "Trusted publishing" docs **[verify the setup steps and whether a first manual publish is required]**.

`.github/workflows/release.yml`
```yaml
name: Release
on:
  release:
    types: [published]
permissions:
  contents: read
  id-token: write       # required for trusted publishing and provenance
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 26
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: npm publish --access public
```

### 6.7 Workflow 5: Using rolecheck in a target project such as NWD (Phase 10)
Only after written approval, and only against a **local** Supabase built from that project's migrations. Never production.

In the target repo, add `rolecheck.yaml` (the spec, written with the team) and `.github/workflows/access-control.yml`:
```yaml
name: Access control
on:
  pull_request:
    paths:
      - "supabase/**"
      - "app/**"
      - "proxy.ts"
      - "middleware.ts"
      - "rolecheck.yaml"
  workflow_dispatch:
permissions:
  contents: read
  security-events: write   # needed to upload SARIF
jobs:
  rolecheck:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v6
      - uses: supabase/setup-cli@v1
        with:
          version: latest   # pin after first success
      - run: supabase start
      - uses: actions/setup-node@v6
        with:
          node-version: 26
      - uses: <your-github-username>/rolecheck@v0
        with:
          spec: rolecheck.yaml
      - name: Upload to code scanning
        if: always()
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: rolecheck.sarif
          category: rolecheck
      - name: Upload HTML report
        if: always()
        uses: actions/upload-artifact@v5
        with:
          name: rolecheck-report
          path: rolecheck-report/
```
Notes:
- Code scanning (the **Security** tab) is free for public repos. Private repos need GitHub Code Security, a paid add-on **[verify]**. On a private repo without it, skip the SARIF step and rely on the HTML artifact.
- Pull requests from forks do not receive secrets. This workflow needs none, which is intentional.

### 6.8 Secrets (if you ever need one)
Repo **Settings > Secrets and variables > Actions > New repository secret**. Reference as `${{ secrets.NAME }}`. Secret values are masked in logs. For this project you should rarely need secrets, because all dynamic testing runs against local Supabase.

### 6.9 Requiring checks before merge
Repo **Settings > Rules > Rulesets > New branch ruleset** **[verify menu path]**: target `main`, enable "Require status checks to pass", add `test` and both `benchmark` matrix jobs. Now a PR that breaks detection cannot merge.

### 6.10 Hardening checklist (a security tool must pass its own standards)
- [ ] Every workflow has a top-level `permissions:` block with the minimum needed
- [ ] Third-party actions pinned to a full commit SHA with the version in a comment, e.g. `uses: supabase/setup-cli@<40-char-sha> # v1.x.y`. Find the SHA on the action's Releases page by clicking the tag.
- [ ] Dependabot keeps pinned actions current. Add `.github/dependabot.yml`:
  ```yaml
  version: 2
  updates:
    - package-ecosystem: github-actions
      directory: /
      schedule:
        interval: weekly
    - package-ecosystem: npm
      directory: /
      schedule:
        interval: weekly
  ```
- [ ] Never use `pull_request_target` with a checkout of PR code
- [ ] User-controlled values passed through `env:`, never interpolated into `run:`
- [ ] `timeout-minutes` set on every job

### 6.11 Debugging workflows
- Failed run: click the red step and read the log from the bottom up
- **Re-run jobs > Enable debug logging** gives verbose output
- Add a temporary step `run: ls -la && env | sort` to inspect the environment (never print secrets)
- `act` (nektos/act) runs workflows locally in Docker. Useful for simple workflows; running Supabase inside it is awkward, so test the benchmark workflow on GitHub instead.
- Validate YAML before pushing with the GitHub Actions extension for VS Code, which also autocompletes keys

---

## 7. Testing against your own projects

### 7.1 Approval template
> I'm building an open source access-control testing tool and would like to run it against a **local** copy of [project], built from our migrations, using test accounts only. It will not touch production or real user data. I'll share every finding with the team privately before anything is published, and any public writeup will be sanitized and reviewed by you first. Are you okay with this?

Keep the replies.

### 7.2 Per-project procedure
1. **Clone and build locally:** `npx supabase start`, `npx supabase db reset`
2. **Check migration completeness:** changes made in the Supabase dashboard may not be in migrations. With approval, run `supabase db pull` against **staging** (not production) and diff. Missing policies mean the local copy is not representative; resolve before trusting results.
3. **Write the spec with the team.** The spec is the team's statement of intended access. Run `rolecheck init`, then walk through each table with a teammate. Spec disagreements are findings in their own right.
4. **Seed realistic data:** at least two users per role and rows in every row class. Otherwise results come back `UNVERIFIED`.
5. **Run scan 3 times** with reset between; confirm identical hashes.
6. **Triage:** every `CONFIRMED` and `INCONCLUSIVE` finding goes into the verification log (Section 5) with manual reproduction and a second reviewer.
7. **Report privately** to the team. Fixes go through their normal PR process.
8. **Re-test** after fixes and record closure.
9. **Feed back:** every false positive or false negative becomes a new lab case and regression test in rolecheck.
10. **Case study:** sanitized writeup (no table names that reveal business logic unless approved, no data), reviewed by the team before publishing.

### 7.3 NWD-specific starting points
- Three roles (Admin, Client, Contractor) map directly to the spec's `roles`
- The admin provisioning/invite flow: test that invite-only signup cannot be bypassed by direct sign-up through the Auth API
- RouteGuard and AuthProvider are client-side; rolecheck's job is proving the database enforces the same rules without them
- Check whether the proxy/middleware uses `getClaims()` or `getUser()` rather than `getSession()`
- The shared Projects component across dashboards means one table likely serves three roles with different scopes: an ideal first spec entry

---

## 8. Repository layout

```
rolecheck/
├── .github/
│   ├── workflows/ (ci.yml, benchmark.yml, mutation.yml, release.yml)
│   └── dependabot.yml
├── action.yml
├── src/
│   ├── cli/            commands: init, validate, fixtures, scan, benchmark, compare-runs
│   ├── spec/           zod schema, loader, JSON Schema export
│   ├── fixtures/       test user seeding
│   ├── oracles/
│   │   ├── http/       PostgREST, Storage, RPC probes
│   │   └── sql/        impersonation in rolled-back transactions
│   ├── static/         db lints, key detection, nextjs analysis, xref (splinter, gitleaks, osv)
│   ├── verdict/        oracle comparison, confidence assignment
│   ├── evidence/       evidence records, redaction, repro commands
│   └── report/         json, sarif, html, console
├── lab/
│   ├── vulnerable/     app, supabase/migrations, seed.sql, access-spec.yaml, ground-truth.yaml
│   └── fixed/          same structure
├── scripts/mutate/     mutation generator
├── test/               unit, integration, snapshot
├── docs/               accuracy.md, accuracy-results.md, threat-model.md, prior-art.md, spec-reference.md
├── SECURITY.md
├── LICENSE
└── README.md
```

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Supabase key format and auth behavior change (legacy keys retiring end of 2026) | Support both key generations; record CLI and Postgres versions in every report; pin CLI version in CI |
| Next.js proxy/middleware behavior changes | Detect both file names; version checks via advisory DB, not hardcoded |
| Write probes damage data | Local-only by default, canary rows with run IDs, verified cleanup, SQL oracle uses rollback |
| False positives erode trust | Two-oracle agreement required for CONFIRMED; evidence on every finding |
| False sense of security from passing scans | Report clearly states what was tested and what was not; UNVERIFIED shown prominently |
| Migrations do not match the real database | Section 7.2 step 2 |
| Scope creep | Static checks limited to the Phase 6 list; new ideas go to a `ROADMAP-LATER.md` |
| Running out of time | Phases 0 to 5 alone produce a demoable, accurate tool |

---

## 10. Launch checklist

**README**
- [ ] One-sentence description and the positioning statement
- [ ] 30-second GIF: vulnerable lab scan, matrix with red cells, click into evidence
- [ ] Quick start (5 commands or fewer)
- [ ] Prior art section (Section 1 table)
- [ ] Accuracy section linking `docs/accuracy-results.md` with current numbers
- [ ] Architecture diagram
- [ ] Limitations: what rolecheck does not test
- [ ] Badges: CI, benchmark, npm version

**Demo**
- [ ] 2 to 3 minute screen recording: write a spec, run scan, explain a CONFIRMED finding and its evidence, fix it, re-run to PASS
- [ ] Hosted static copy of the lab HTML report

**Writeups**
- [ ] Technical blog post: why two oracles, how verdicts are assigned, mutation testing results
- [ ] Sanitized NWD case study (team-approved)
- [ ] Portfolio page on bradgcharles.com
- [ ] LinkedIn post

**Interview prep**
- [ ] Explain why HTTP and SQL oracles can disagree and what that means
- [ ] Explain grants vs RLS ordering
- [ ] Walk through one mutation that survived and what you changed
- [ ] Explain your GitHub Actions hardening choices

---

## Appendix A: Spec example

```yaml
# rolecheck.yaml
version: 1

roles:
  anon: {}                        # unauthenticated, publishable/anon key only
  admin:
    users: [admin_1, admin_2]
    assign: { app_metadata: { role: admin } }
  client:
    users: [client_1, client_2]
    assign: { app_metadata: { role: client } }
  contractor:
    users: [contractor_1, contractor_2]
    assign: { app_metadata: { role: contractor } }

scopes:
  none: "false"
  all: "true"
  own_project: "client_id = :uid"
  assigned_project: "id in (select project_id from project_members where user_id = :uid)"
  own_profile: "id = :uid"

tables:
  public.projects:
    anon:       { select: none, insert: none, update: none, delete: none }
    client:     { select: own_project, insert: own_project, update: own_project, delete: none }
    contractor: { select: assigned_project, insert: none, update: none, delete: none }
    admin:      { select: all, insert: all, update: all, delete: all }
    immutable_columns: [client_id]   # ownership column; changing it is always tested

  public.profiles:
    anon:       { select: none, insert: none, update: none, delete: none }
    client:     { select: own_profile, update: own_profile, insert: none, delete: none }
    contractor: { select: own_profile, update: own_profile, insert: none, delete: none }
    admin:      { select: all, update: all, insert: none, delete: none }

storage:
  contracts:
    anon:   { read: none, write: none }
    client: { read: "(storage.foldername(name))[1] = :uid", write: none }
    admin:  { read: all, write: all }

rpc:
  public.get_dashboard_stats:
    anon: deny
    client: allow
    contractor: allow
    admin: allow
```

## Appendix B: Evidence record example

```json
{
  "id": "RC-0007",
  "verdict": "CONFIRMED",
  "category": "row_access",
  "table": "public.projects",
  "role": "contractor",
  "user": "contractor_1",
  "operation": "select",
  "expected_scope": "assigned_project",
  "result": "OVER",
  "unexpected_row_ids": ["b3f1...", "9c2e..."],
  "oracle_http": {
    "request": "GET /rest/v1/projects?select=id",
    "headers": { "Authorization": "Bearer <redacted>", "apikey": "<redacted>", "Prefer": "count=exact" },
    "status": 200,
    "content_range": "0-5/6",
    "returned_ids": ["..."],
    "repro": "curl -H 'apikey: $KEY' -H 'Authorization: Bearer $TOKEN' '$URL/rest/v1/projects?select=id'"
  },
  "oracle_sql": {
    "role": "authenticated",
    "claims_sub": "<contractor_1 uuid>",
    "statement": "select id from public.projects",
    "returned_ids": ["..."],
    "rolled_back": true
  },
  "static_corroboration": ["policy 'projects_select' uses USING (true)", "splinter: none"],
  "suggested_fix": "alter policy projects_select on public.projects using (id in (select project_id from project_members where user_id = (select auth.uid())));",
  "context": {
    "rolecheck_version": "0.1.0",
    "supabase_cli_version": "<recorded>",
    "postgres_version": "<recorded>",
    "spec_sha256": "<hash>",
    "schema_sha256": "<hash>",
    "run_id": "<uuid>"
  }
}
```

## Appendix C: Seeded flaw catalogue (vulnerable lab)

| ID | Flaw | Detected by |
|---|---|---|
| V01 | RLS disabled on `messages` | Oracles A+B, static, splinter |
| V02 | RLS enabled with no policies on `audit_log` (functional, severity info) | Oracles (UNDER), static, splinter |
| V03 | `projects` select policy `using (true)`: cross-tenant read | Oracles A+B, static |
| V04 | `projects` update policy has no `with check`: client can reassign `client_id` | Oracles A+B (ownership change probe), static |
| V05 | Admin check reads `user_metadata.role`: self-escalation | Escalation probe, static, splinter |
| V06 | `security definer` view exposing all `invoices` | Oracles A+B, static, splinter |
| V07 | `security definer` RPC with no auth check, callable by anon | RPC probe, static |
| V08 | Insert policy lets contractors create `projects` | Oracles A+B |
| V09 | Peer delete allowed on `messages` | Oracles A+B |
| V10 | `profiles` readable by anon through `to public using (true)` | Oracles A+B, static |
| V11 | `contracts` bucket public / missing owner check | Storage probe |
| V12 | Secret key in a `NEXT_PUBLIC_` variable, present in client bundle | Static, gitleaks |
| V13 | Legacy service_role JWT committed then removed (still in git history) | Static, gitleaks |
| V14 | Server action authorizes with `getSession()` | Static |
| V15 | Proxy matcher misses `/api/admin` | Static |
| V16 | Route handler writes data with no auth check | Static |
| V17 | `package.json` fixture with a Next.js version affected by CVE-2025-29927 (fixture only, never installed or run) | Static (OSV) |
| V18 | Row containing `<script>` payload in `messages` | Report XSS test (must render as text) |

## Appendix D: Verdict table

| Oracle A (HTTP) | Oracle B (SQL) | Static | Verdict |
|---|---|---|---|
| Violation | Violation | any | CONFIRMED |
| Violation | Conforms | any | INCONCLUSIVE |
| Conforms | Violation | any | INCONCLUSIVE |
| Conforms | Conforms | Flagged | PASS with SUSPECTED static note |
| Conforms | Conforms | Clean | PASS |
| Error / no data | any | any | UNVERIFIED |
| any | Error / no data | any | UNVERIFIED |
| Not applicable (code check) | Not applicable | Flagged | SUSPECTED |
