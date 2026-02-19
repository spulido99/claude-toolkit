# Tool Quality Checklist

Use this checklist to verify every tool before shipping. Each section maps to principles from the AI-Friendly Tool Design skill. A tool should pass **all applicable checks** before being added to the agent's catalog.

---

## Naming & Semantics

- [ ] Tool name describes a **domain operation**, not a CRUD verb or HTTP method (`get_account_balances` not `get_resource`)
- [ ] Tool name uses **snake_case** consistently (`transfer_funds` not `transferFunds` or `TransferFunds`)
- [ ] **One term per concept** across the entire tool catalog (always `account_id`, never `acct_id` or `account_number` in some tools)
- [ ] No abbreviations or acronyms in names unless universally understood (`get_account_balances` not `get_acct_bal`)

---

## Descriptions & Discovery

- [ ] Description has a **clear one-line summary** of what the tool does
- [ ] Description includes **trigger phrases** in the user's primary language ("Use when the user says: ...")
- [ ] All parameters are **documented** with type, format, example value, and constraints
- [ ] Description includes at least one **response example** or describes the response structure

---

## Parameters

- [ ] Money amounts use the **structured format**: `{"value": decimal, "currency": "ISO 4217"}` — never bare floats
- [ ] Dates use **ISO 8601** format (`YYYY-MM-DD`) — never locale-specific formats
- [ ] Parameters have **sensible defaults** where applicable (`limit: 20`, `include_details: false`, `date_from: 30 days ago`)
- [ ] No **secrets, tokens, or credentials** passed as parameters — authentication is handled at the framework level
- [ ] All enum parameters are **documented with allowed values** in the description and schema (`status: Literal["active", "suspended", "closed"]`)

---

## Responses

- [ ] Response follows the **standard pattern** with all required fields: `data`, `formatted`, `available_actions`, `message_for_user`
- [ ] Error responses follow the **error pattern** with: `code` (machine-readable), `message` (human-readable), `remediation` (next steps)
- [ ] No **sensitive data leaks** in responses (no full card numbers, no SSN, no passwords, no internal system IDs that expose infrastructure)
- [ ] Response includes `formatted_spoken` if the tool will be used in **voice channels**

---

## Operation Levels

- [ ] Tool has an **assigned operation level** (1-5) declared in the docstring: `Operation Level: N (Category)`
- [ ] Level 3+ tools return `pending_confirmation` status **before executing** — they do not execute directly
- [ ] Level 4+ tools use **delegated confirmation** through a separate channel (push notification, OTP, biometric)
- [ ] Level 3+ transactional tools accept an **`idempotency_key`** parameter to prevent duplicate execution

---

## Organization

- [ ] Tool belongs to a **domain group** (e.g., `accounts`, `transfers`, `investments`) with other related tools
- [ ] Domain module exports a **`TOOLS` list** for easy registration with the agent framework
- [ ] Tool has **max 15 parameters** — if more are needed, split into multiple tools or use nested objects
- [ ] Domain has **max 10 tools** — if more are needed, split into sub-domains

---

## Coverage

- [ ] Tool maintains **parity with UI** — every user-facing action in the app has a corresponding tool (or is documented as an intentional exclusion)
- [ ] Domain includes **batch/bulk operations** where users commonly need to act on multiple items (e.g., `export_transactions`, `bulk_categorize`)
- [ ] Domain includes **search/filter tools** for every major entity (`find_customer`, `search_transactions`, `find_account`)

---

## Quick Reference

| Check | Principle | Critical? |
|-------|-----------|-----------|
| Domain operation name | Semantic Clarity | Yes |
| Trigger phrases | Natural Language Compatibility | Yes |
| Structured money format | Structured Types | Yes |
| Standard response pattern | Rich Response Semantics | Yes |
| Available actions | Tool Graph | Yes |
| Operation level assigned | Operation Levels | Yes |
| Pending confirmation for L3+ | Delegated Confirmations | Yes |
| Idempotency key for L3+ | Idempotency | Yes |
| No sensitive data in response | Security | Yes |
| Search tools per entity | Search-First | Recommended |
| Voice-optimized format | Rich Semantics | Recommended |
| Batch operations | Coverage | Recommended |
