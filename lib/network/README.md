# Network directory boundary

`inNetwork(query, result?)` returns unknown without a matching plan ID, insurer,
provider NPI and a sourced, dated result. `lookupInNetwork(query, port?)` accepts an
injected FhirDirectoryPort; no live port or fetch is implemented. Directory failures
stay unknown. A directory result is evidence to confirm, not a coverage guarantee.

Verification status: UNVERIFIED. The local fixtures contain no payer FHIR responses;
docs/PLAN.md only says FHIR directories are flaky and Network should remain unknown.
No network requests were made. Consequently this repository cannot substantiate
which payers currently expose working CMS-required APIs, their base URLs, supported
resources, authentication, or plan-level completeness.

Reference URLs for later verification (not verified endpoint listings):
- CMS Interoperability and Patient Access rule / Provider Directory API background:
  https://www.cms.gov/priorities/key-initiatives/burden-reduction/interoperability/policies-and-regulations/cms-interoperability-and-patient-access-final-rule-cms-9115-f
- HL7 Da Vinci PDex Plan-Net directory implementation guide:
  https://hl7.org/fhir/us/davinci-pdex-plan-net/

Do not infer an operational endpoint or an in-network answer from these references.
Before implementing a port, record the payer's published base URL and CapabilityStatement,
plan/network identifiers, pagination, retrieval date and representative responses.
