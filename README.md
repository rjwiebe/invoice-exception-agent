# Invoice Exception Agent

An end-to-end accounts-payable workflow demo: invoices are extracted, checked against vendor and purchase-order records, and either cleared automatically or sent to a person with a clear explanation and a recorded decision.

This is intentionally a small product slice—not a chatbot, payment system, or SaaS platform. It runs locally with synthetic data and a deterministic mock AI provider; no API key or external service is required.

## The problem and the user

AP teams receive invoices in inconsistent formats. Matching each one by hand is repetitive, while mistakes such as duplicate invoices, unapproved price changes, PO overruns, and changed bank details can delay work or create payment risk.

The primary user is an **AP clerk** triaging the invoice queue. An **AP manager** handles higher-value approvals. The agent does the repetitive extraction and matching; a person remains responsible for exceptions and overrides.

## Screenshots

All records and invoice text shown here are synthetic.

![Inbox with an invoice waiting for review and automatically cleared examples](docs/screenshots/inbox.png)

![Invoice exception review with rule findings and the AI's advisory explanation](docs/screenshots/exception-review.png)

![Audit log with a verified hash chain](docs/screenshots/audit-log.png)

## Run locally

Requires Node.js 22 and npm.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On an empty database, the app seeds reference data, three invoices cleared through the real workflow, and one price-variance exception waiting in the inbox. `npm start` also seeds an empty database, which is useful for a fresh hosted volume.

Useful commands:

```bash
npm test           # workflow, rules, approval policy, and audit tests
npm run typecheck  # TypeScript checks
npm run build      # production build
npm run seed       # reset and reseed the demo (destructive to local demo data)
```

The default database is `data/app.db` (ignored by git). Set `DATABASE_PATH` to use another SQLite file.

### Optional OpenAI provider

The default mock needs no key. To try the included OpenAI adapter, copy `.env.local.example` to `.env.local` and set `OPENAI_API_KEY`; `OPENAI_MODEL` is optional and defaults to `gpt-4o-mini`. The adapter has not been exercised against the live API. Provider output is schema-validated; failed or invalid OpenAI responses fall back to the mock and create an `ai.fallback` audit entry. OpenAI mode sends invoice text or extracted invoice fields to OpenAI—use synthetic data only.

## Demo flow

The initial inbox is deliberately populated rather than empty: it has one live price exception plus three previously cleared synthetic invoices. These rows are created by the same intake, extraction, rules, and audit pipeline as a newly submitted invoice.

1. Open the Orbit Office Furnishings exception. Compare its invoice line price to the PO and see why the deterministic rules hold it.
2. Review the AI explanation and recommendation. It is clearly marked advisory; the rule findings remain the source of truth.
3. Submit **Clean match**. It clears without a human decision. The detail page shows each check and the recorded system actions.
4. Submit **Missing PO number**. Choose **Correct**, enter `PO-10025`, explain the correction, and submit. The app re-runs the checks; it clears only after they pass.
5. Open **Audit log**. Inspect the entries and verify the chain. If useful, submit the duplicate scenario and try to approve it as Sam; the server blocks the $48,000 approval. Switch to Dana and reject it—the right control is to stop a second payment, even when a manager is reviewing it.

Use **Reset demo data** to restore the seeded starting state. It clears the current demo invoices and audit history.

## What uses AI—and what does not

| Step | Implementation | Reason |
|---|---|---|
| Extract vendor, invoice fields, and line items from raw text | `AIProvider` interface; deterministic regex mock by default, optional OpenAI adapter | Invoice layouts vary. Outputs are validated against a Zod schema before use. |
| Check vendor status, PO ownership/status, duplicate number, arithmetic, line prices/quantities, PO balance, currency, and bank details | Deterministic TypeScript rules | Financial checks should be repeatable, inspectable, and testable—not probabilistic. |
| Clear an invoice or route it to review | Deterministic TypeScript | A model never decides whether an invoice is eligible to proceed. |
| Explain findings and suggest an action | AI provider; the mock is rule-based | Helps a person understand an exception. Its recommendation is advisory and cannot change rule results. |
| Approve, reject, or correct an exception | Human decision, validated and recorded by the server | Keeps accountability with the reviewer. A correction re-runs the checks. |

## Architecture

```mermaid
flowchart LR
  Reviewer --> UI[Next.js App Router UI]
  UI --> API[Next.js route handlers]
  API --> Flow[TypeScript workflow pipeline]
  Flow --> AI[AIProvider: mock or OpenAI]
  AI --> Zod[Zod output validation]
  Zod --> Rules[Deterministic rules engine]
  Rules --> DB[(SQLite)]
  Flow --> Audit[Hash-chained audit log]
  Audit --> DB
  Reviewer -->|approve / reject / correct| API
```

There is one Next.js application and one SQLite database—no microservices or separate backend.

- [`src/lib/pipeline.ts`](src/lib/pipeline.ts) orchestrates intake, provider calls, validation, rules, routing, and reviewer decisions.
- [`src/lib/ai/provider.ts`](src/lib/ai/provider.ts) defines the provider boundary. The pipeline validates the provider's `unknown` response before using it.
- [`src/lib/rules.ts`](src/lib/rules.ts) is a pure deterministic evaluator. It returns structured findings with codes, severity, and expected/actual values.
- [`src/lib/db.ts`](src/lib/db.ts) creates the SQLite schema; [`src/lib/repo.ts`](src/lib/repo.ts) maps rows to domain types.
- [`src/lib/audit.ts`](src/lib/audit.ts) appends events and verifies the hash chain.
- [`src/lib/seed.ts`](src/lib/seed.ts) loads synthetic vendors, POs, and starter invoices through the same pipeline used at runtime.

## Data and audit model

SQLite tables:

- `vendors`, `purchase_orders`, `po_lines`: synthetic ERP records.
- `invoices`: raw invoice text, status, extracted data, check results, explanation, and resolution.
- `reviews`: reviewer, role, decision, required reason, and field corrections.
- `audit_log`: actor, action, timestamp, details, previous hash, and entry hash.

The audit entry hash includes the prior entry's hash. Editing or deleting an interior entry breaks later links; the UI verifies the chain. This is **tamper-evident, not tamper-proof**: removing a suffix can go undetected unless the latest hash is anchored outside this database. A production audit service would also use immutable storage, access controls, and an external checkpoint.

## Important product and engineering decisions

1. **Rules own the decision.** A model can extract and explain, but cannot clear, reject, or edit rule findings.
2. **Unknown is not a safe default.** Missing required fields—including currency—create a review finding instead of silently assuming a value.
3. **Corrections are re-evaluated.** Header corrections are validated, logged with before/after values, and sent back through the same rules.
4. **Approval limits are server-side.** The demo requires an AP manager for approvals above $25,000 or when the total is unknown. A reason is required for every human decision.
5. **Auditability is a product surface.** The reviewer can see rule evidence, AI output/provider, reviewer action, and chain verification instead of receiving a black-box answer.

## Deployment and the SQLite tradeoff

For this version, the simplest realistic host is **one Node.js service with a persistent disk**, such as Railway. Deploy the repository from GitHub, set the build command to `npm run build`, attach a volume mounted at `/data`, set `DATABASE_PATH=/data/app.db`, and use `npm start`. The `prestart` script seeds the database only when that volume is empty. Add `OPENAI_API_KEY` only if you intentionally want live model calls. Check [Railway's current volume documentation](https://docs.railway.com/volumes/reference) and [pricing](https://docs.railway.com/pricing/plans) before deploying.

This is a single-instance SQLite design. Railway volumes are mounted when the service starts, persist across deployments, and do not support multiple replicas for the same service; redeployments can briefly interrupt service. That is a reasonable tradeoff for a low-traffic application demo and keeps the code easy to run and explain.

I would **not deploy this exact local-file SQLite setup as ordinary Vercel serverless functions**: function instances are not a durable shared filesystem for a database file. If Vercel or horizontal scaling becomes a requirement, move persistence to a managed database (for example Postgres) or deliberately adopt a hosted SQLite-compatible service; do not try to make a local `.db` file act like shared storage.

## What I would productionize next

- Replace the demo persona selector with SSO and server-verified authorization; disable or restrict the public reset endpoint.
- Move from SQLite to managed Postgres if multiple instances, concurrent AP teams, or operational recovery require it. Add migrations, idempotency keys, and a durable retry/outbox strategy.
- Add secure document ingestion/OCR, malware scanning, data retention controls, and a human correction path for line items.
- Expand policy for partial receipts/three-way matching, credit memos, and currency conversion; make tolerances configurable and versioned.
- Add an evaluation set for extraction and explanation quality, plus model latency/cost monitoring. Keep the deterministic rules independently tested.
- Store audit events in access-controlled immutable storage and externally anchor chain checkpoints.

## Deliberately out of scope

PDF upload/OCR, real authentication/SSO, multi-tenant access, payment execution, partial-receipt three-way matching, production accounting integrations, and multi-currency accounting are not implemented. The reviewer switcher and reset action are **demo controls, not security features**. This project contains only synthetic data; do not use it for real invoices.
