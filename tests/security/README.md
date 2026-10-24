# API security regressions

Run `npx vitest run tests/security --configLoader runner`.

The suite discovers every `app/api/**/route.ts` from the filesystem, imports its
actual exports (including Inngest's destructured SDK exports), and checks each
HTTP method. A new route receives ownership and Origin probes by default.
`public-routes.ts` contains exact public route/method exceptions and their reasons.
Case creation has a separate ownership exception because it creates a new session
and resource; it still receives Origin and error probes. Demo routes receive
switch/Origin probes rather than case-ownership probes.

Tests use real route handlers, signed sessions, ownership guards, Origin checks,
webhook signature verification, and in-memory rate-limit counters. Storage,
provider/network, demo filesystem/clock, and background execution boundaries are
replaced so the suite cannot send messages, start research, or write demo state.
All inputs and credentials are synthetic. The suite does not modify production files.

## Fixed in task #57

All 45 regressions below are fixed in production routes; the original 154 security
checks are unchanged. Reviews, ranking previews, and usage enforce case ownership.
State-changing review, ranking, and demo routes enforce same-origin requests.
Storage failures and Inngest registration failures return generic JSON errors;
SSE failures emit a generic error event. Diagnostic errors stay in server logs.
Demo access requires exactly `WAYFINDER_DEMO=1`; `true` is disabled.

Validation: all **154/154 security checks pass**, and the full suite passes
**1,067 tests** (98 files; 1 skipped, 2 todo). Typecheck, lint (3 pre-existing
warnings), and the production build pass. No security assertions were weakened.

## Findings on the task-52 base

The original suite had 154 tests: **109 passed, 45 failed**. These remained ordinary
failing tests, without skips or expected failures; the production fixes turn the
same regressions green.

| Gap | Routes |
| --- | --- |
| Missing ownership (other, absent, tampered session) | `GET /api/cases/[id]/usage`, `GET/POST /api/reviews`, `POST /api/ranking/preview` |
| Missing Origin checks (absent, foreign, opaque `null`) | `POST /api/reviews`, `POST /api/ranking/preview`, `POST /api/demo/{advance,replies,seed}` |
| Raw storage/provider errors in JSON | `GET/POST /api/reviews`, `POST /api/ranking/preview`, all four demo routes |
| Raw storage errors in SSE error events | `GET /api/cases/[id]/stream` |
| Raw network error in SDK registration response | `PUT /api/inngest` returns the failed registration's exception message |
| Uncaught storage exceptions rather than a controlled response | `GET/PATCH /api/cases/[id]`, `POST /api/cases/[id]/research`, `GET /api/cases/[id]/{shortlist,stream}` |
| Demo switch contract mismatch | All four demo routes accept `WAYFINDER_DEMO=true`; task #52 requires exactly `1` |

The uncaught-exception probes identify an absent route error contract; they do
not establish that a deployed Next.js production response exposes the exception.
The SSE and JSON error probes directly demonstrate response-body disclosure.
The demo `true` failures identify a contract mismatch with the existing deliberate
`1`/`true` implementation, not a way to bypass a disabled environment switch.

Research case quota (3/hour), session quota (10/hour across separate owned cases),
429/Retry-After, and window reset pass. Admission tests keep the synthetic case
startable between attempts so workflow state conflicts cannot hide the limiter.
The rate-limit coverage check scans route source for direct limiter calls and
requires a saturation probe for each such route; it does not claim to discover
limits applied transitively inside arbitrary downstream services.

AgentMail and AgentCall reject missing/bad signatures before database access.
Valid synthetic signed deliveries reach a failing database and return a clean 500.
Inngest POST rejects an invalid signature in production; PUT is its registration
protocol and receives a network-failure hygiene probe. GET readiness stays public.

The existing auth/rate-limit/webhook tests also pass (47 tests). Full-suite result:
97 existing test files pass; 1,022 tests pass, 45 new regressions fail, 1 is skipped,
and 2 are todo. Project typecheck and focused ESLint pass. This describes the task-52 baseline before the task-57 fixes.
