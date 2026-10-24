Run `npx vitest run tests/journey --configLoader runner`.

`offline.test.ts` drives the real intake, confirmation, and shortlist routes; the real offline research orchestrator (including curator); validated outreach HTTP handlers and service; gate; MockMailer/MockCaller; signed AgentMail webhook handler; inbox ingestion and fixture classifier; task approval HTTP handler; and connection workflow with the production in-memory context store's follow-up draft adapter. Fetch throws, so an accidental network dependency fails the test. Only Date is faked; research deadlines retain real timers.

Each of the three synthetic reports runs independently. Research resource identity and evidence flow into outreach selection. Since recorded resource addresses are not owned demo addresses, outreach adds an explicitly synthetic intake-door evidence row at journey.example and removes other contact-door claims from that test adapter's targets. This does not modify research output or fixtures and is not proof of live contact discovery.

The signed reply requests a referral and produces an unsent next draft. A separate silent contact reaches business days 3, 7 and 10; the replied contact's follow-up workflow correctly terminates on reply. Follow-up creation uses InMemoryContactContextStore, which records IDs and ordinals but not full message bodies. No follow-up is approved or sent automatically.

Two explicit TODOs identify missing testable application paths: appointment booking (only a state-machine event exists), and full follow-up message/classification persistence (the production implementation requires SQL). These tests do not claim to cover those steps.

The helper implements only persistence, including atomic approval reservation and contact-cap enforcement. It does not replace handlers, agents, safety checks, or channels. Existing journey.test.ts covers UI journey navigation separately.
