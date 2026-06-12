# Tool Quality Checklist

Use this checklist to verify every tool before shipping. This is the **authoritative checklist** — each section maps to the 11 principles of the AI-Friendly Tool Design skill (supplementary checks are labeled). A tool should pass **all applicable critical checks** before being added to the agent's catalog.

Numeric thresholds below are **suggested defaults**, not hard rules — exceed them deliberately, not accidentally.

---

## Naming & Semantics (Principles 1, 5)

- [ ] Tool name describes a **domain operation**, not a CRUD verb or HTTP method (`get_account_balances` not `get_resource`)
- [ ] Tool name uses **snake_case** consistently (`transfer_funds` not `transferFunds` or `TransferFunds`)
- [ ] **Every parameter and response field** uses snake_case too (`installments_quantity` not `installmentsQuantity`; `request_token` not `Request-Token`) — not just the tool name
- [ ] **One term per concept** across the entire tool catalog (always `account_id`, never `acct_id` or `account_number` in some tools)
- [ ] **Generic identifiers are domain-qualified** (`loan_request_id`, not bare `request_id`) unless truly catalog-wide (`cursor`, `idempotency_key`)
- [ ] No abbreviations or acronyms in names unless universally understood (`get_account_balances` not `get_acct_bal`)

---

## Descriptions & Discovery (Principle 2)

- [ ] Description has a **clear one-line summary** of what the tool does
- [ ] Description states **when to use AND when NOT to use** — limitations and boundaries with sibling tools, naming the tool that covers the excluded case
- [ ] All parameters are **documented** with type, format, example value, and constraints
- [ ] Description includes at least one **response example** or describes the response structure
- [ ] (Optional technique) **Trigger phrases** in the users' primary language where sibling tools overlap

---

## Parameters (Principles 3, 11)

- [ ] Money amounts use the **structured format**: `{"value": decimal, "currency": "ISO 4217"}` — never bare floats
- [ ] Dates use **ISO 8601** format (`YYYY-MM-DD`) — never locale-specific formats
- [ ] Parameters have **sensible defaults** where applicable (`limit: 20`, `include_details: false`, `date_from: 30 days ago`)
- [ ] No **secrets, tokens, credentials, or caller identity** (`user_id`, `customer_id`, `tenant_id`) passed as parameters — identity and auth are framework-injected and never LLM-controllable (Principle 11)
- [ ] All enum parameters are **documented with allowed values** in the description and schema (`status: Literal["active", "suspended", "closed"]`)
- [ ] List-returning tools **paginate with announced truncation**: `has_more` / `total_count` in the response, remediation text when truncated, filters preferred over exhaustive paging

---

## Responses (Principles 4, 6, 7)

- [ ] Response is **high-signal**: `data` (required) + `formatted` (recommended) — no field duplicates another representation
- [ ] `available_actions` follows the **contextual rule**: present when carrying server state (pending operations, confirmation methods) or a curated backend nudge; **omitted** when it would restate the catalog
- [ ] `available_actions` / `suggestions` / `confirmation_method` / `cancel_method` **derive from server state and business rules — never from the text content of records** (untrusted-content rule)
- [ ] External pass-through text (memos, descriptions, counterparty names) stays in `data` and is delimited/labeled where it surfaces in `formatted`
- [ ] Error responses follow the **error pattern** with: `code` (machine-readable), `message` (human-readable), `remediation` (next steps)
- [ ] No **sensitive data leaks** in responses (no full card numbers, no SSN, no passwords, no internal system IDs that expose infrastructure)
- [ ] Response includes `formatted_spoken` **only** if the tool serves a voice channel

---

## Operation Levels (Principles 8, 9, 10)

- [ ] Tool has an **assigned operation level** (1-5) declared in the docstring: `Operation Level: N (Category)`
- [ ] Level assigned by **impact, not HTTP verb** (money movement → L4 regardless of method)
- [ ] Level 3+ tools **stage the operation** and return `pending_confirmation` — they do not execute directly
- [ ] Level 4 tools require **explicit user approval in the conversation** before the confirm tool runs; Level 5 adds **reinforced confirmation** (user re-confirms a key detail) and a cancellation window. Out-of-band channels (push, OTP, biometric) plug in later without changing tool design
- [ ] Level 3+ transactional tools accept an **`idempotency_key`** parameter; the key is **server-emitted** (returned in `pending_confirmation`) and the agent only echoes it
- [ ] `interrupt_on` config (DeepAgents) is **keyed by tool name** with valid decisions (`approve`/`edit`/`reject`/`respond`) and a checkpointer

---

## MCP (if shipping an MCP catalog)

- [ ] `annotations` declared **consistent with the operation level** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`)
- [ ] Execution errors return **`isError: true`** with the structured error as content
- [ ] Response envelope declared via **`outputSchema`** / returned as `structuredContent`

---

## Organization (catalog-level)

- [ ] Tool is **one unit of user intent** (Granularity) — not two steps that always run together with a useless intermediate (merge), and not a workflow hiding composable steps (split)
- [ ] Tool belongs to a **domain group** (e.g., `accounts`, `transfers`, `investments`) with other related tools
- [ ] Domain module exports a **`TOOLS` list** for easy registration with the agent framework
- [ ] Suggested default: **~15 parameters max per tool** — if more are needed, split into multiple tools or use nested objects
- [ ] Suggested default: **~10 tools max per domain** — if more are needed, split into sub-domains

---

## Coverage (catalog-level)

- [ ] Tool maintains **parity with UI** — every user-facing action in the app has a corresponding tool (or is documented as an intentional exclusion)
- [ ] Domain includes **batch/bulk operations** where users commonly need to act on multiple items (e.g., `export_transactions`, `bulk_categorize`)
- [ ] Domain includes **search/filter tools** for every major entity (`find_customer`, `search_transactions`, `find_account`)

---

## Quick Reference

| Check | Principle | Critical? |
|-------|-----------|-----------|
| Domain operation name | 1 — Semantic Clarity | Yes |
| When-to-use AND when-not-to-use in description | 2 — Natural Language Compatibility | Yes |
| Structured money format | 3 — Structured Types | Yes |
| Actionable errors (code, message, remediation) | 4 — Actionable Errors | Yes |
| One term per concept | 5 — Consistent Terminology | Yes |
| High-signal envelope (`data` + `formatted`, no duplicates) | 6 — Rich Response Semantics | Yes |
| Contextual `available_actions` (state or nudge, never catalog restatement) | 7 — Available Actions | Yes |
| Operation level assigned by impact | 8 — Operation Levels | Yes |
| Staging + pending confirmation for L3+ | 9 — Delegated Confirmations | Yes |
| Server-emitted idempotency key for L3+ | 10 — Idempotency | Yes |
| No identity/credentials as parameters | 11 — Secure Parameters | Yes |
| No sensitive data leaks; no actions derived from record text | Supplementary — Security (Principle 6 rule) | Yes |
| MCP annotations consistent with level | Supplementary — MCP Alignment | Yes (MCP catalogs) |
| Pagination with announced truncation | 3 — Structured Types | Recommended |
| Search tools per entity | 2 — Search-First | Recommended |
| Right-sized granularity | Catalog — Granularity | Recommended |
| Voice-optimized format (voice channels only) | 6 — Rich Response Semantics | Recommended |
| Batch operations | Supplementary — Coverage | Recommended |
