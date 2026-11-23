# Ruling remove-multiuser-2
Package commit: d9ff075b
Changes design: yes
Changes contract: no
## Ruling
`mintTestPseudonym` stores the address `<userId>@` plus `PSEUDONYMOUS_EMAIL_DOMAIN` lower-cased whole, as Better-Auth stores every email, so the test row matches a row the anonymous plugin makes and sign-in lookups find it. The spec's e2e seams section and its test line say so. No interface row changes: I1 does not name the e2e seam, and the function's signature is unchanged.
## Re-read
- docs/superpowers/specs/2026-11-22-remove-multiuser-design.html § sec-design-e2e
- docs/superpowers/specs/2026-11-22-remove-multiuser-design.html § sec-tests-changed
## Affected units
- remove-multiuser: clarification
## Build graph
- remove-multiuser
