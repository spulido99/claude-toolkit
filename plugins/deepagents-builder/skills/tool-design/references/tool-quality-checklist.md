# Tool Quality Checklist

Use this checklist to verify every tool before shipping. Each section maps to principles from the AI-Friendly Tool Design skill. A tool should pass **all applicable checks** before being added to the agent's catalog.

---

## Naming & Semantics

- [ ] Tool name describes a **domain operation**, not a CRUD verb or HTTP method (`get_account_balances` not `get_resource`)
- [ ] Tool name uses **snake_case** consistently (`transfer_funds` not `transferFunds` or `TransferFunds`)
- [ ] **Every parameter and response field** uses snake_case too (`installments_quantity` not `installmentsQuantity`; `request_token` not `Request-Token`) — not just the tool name
- [ ] **One term per concept** across the entire tool catalog (always `account_id`, never `acct_id` or `account_number` in some tools)
- [ ] No abbreviations or acronyms in names unless universally understood (`get_account_balances` not `get_acct_bal`)

---

## Descriptions & Discovery

- [ ] Description has a **clear one-line summary** of what the tool does
- [ ] Description includes **trigger phrases** in the user's primary language ("Use when the user says: ...") — **3-5 max**, high-value only
- [ ] Description states **when NOT to use the tool** and the boundary with neighboring tools
- [ ] All parameters are **documented** with type, format, example value, and constraints
- [ ] Description includes at least one **response example** or describes the response structure

---

## Parameters

- [ ] Money amounts use the **structured format**: `{"value": "decimal string", "currency": "ISO 4217"}` — never IEEE-754 floats anywhere in the chain (decimal strings or integer minor units, per Stripe/Google/PayPal practice)
- [ ] Dates use **ISO 8601** format (`YYYY-MM-DD`) — never locale-specific formats
- [ ] Parameters have **sensible defaults** where applicable (`limit: 20`, `include_details: false`, `date_from: 30 days ago`)
- [ ] No **secrets, tokens, credentials, or caller identity** (`user_id`, `customer_id`, `tenant_id`) passed as parameters — identity and auth are framework-injected and never LLM-controllable (Principle 11)
- [ ] All enum parameters are **documented with allowed values** in the description and schema (`status: Literal["active", "suspended", "closed"]`)

---

## Responses

- [ ] Response follows the **standard pattern**: `data` always; `formatted` where useful; `available_actions` where next steps are **state-dependent** (≤3); `message_for_user` only when phrasing needs backend knowledge — **no field duplicates another's content**
- [ ] Response size is **bounded**: pagination/filtering/truncation with sensible defaults on anything that can grow; truncated responses say so and steer recovery; read-heavy tools offer `response_format: "concise" | "detailed"`
- [ ] Error responses follow the **error pattern** with: `code` (machine-readable), `message` (human-readable), `remediation` (next steps)
- [ ] No **sensitive data leaks** in responses (no full card numbers, no SSN, no passwords, no internal system IDs that expose infrastructure)
- [ ] Response includes `formatted_spoken` if the tool will be used in **voice channels** (omit otherwise)

---

## Operation Levels

- [ ] Tool has an **assigned operation level** (1-5) declared in the docstring: `Operation Level: N (Category)` — and **list/read tools are Level 1**, never higher
- [ ] MCP tools also declare the level as **`annotations`** (`readOnlyHint`/`destructiveHint`/`idempotentHint`) — client safety UIs read annotations, not prose
- [ ] **One confirmation layer per deployment**: either Level 3+ tools return `pending_confirmation` before executing, **or** the framework/client interrupts (`interrupt_on` / MCP elicitation) — not both (double-confirmation only at Level 5)
- [ ] Level 4+ tools require **explicit user confirmation** in the conversation before executing (Level 5: reinforced confirmation — user re-confirms a key detail + cancellation window). Stronger out-of-band channels (OTP, biometric, push) only if the app supports them
- [ ] Level 3+ transactional tools accept an **`idempotency_key`** parameter — **generated server-side on first call and returned**; the agent only reuses it on retries (LLMs must never invent keys)

---

## Organization

- [ ] Tool belongs to a **domain group** (e.g., `accounts`, `transfers`, `investments`) with other related tools
- [ ] Domain module exports a **`TOOLS` list** for easy registration with the agent framework
- [ ] Tool aims for **≤7 parameters** (hard ceiling 15) — if more are needed, split into multiple tools or use nested objects; don't make the model fill values your code already knows
- [ ] Domain has **max 10 tools** — if more are needed, split into sub-domains; active set per agent/subagent stays **≤20**
- [ ] Tool is **one unit of user intent** (Granularity) — not two steps that always run together with a useless intermediate (merge), and not a workflow hiding composable steps (split)

---

## Coverage

- [ ] Tool catalog maintains **parity of outcomes with the UI** — everything the user can accomplish in the app is reachable through tools (or documented as an intentional exclusion). Parity is per **goal**, not per button: one consolidated tool may cover several UI actions
- [ ] Domain includes **batch/bulk operations** where users commonly need to act on multiple items (e.g., `export_transactions`, `bulk_categorize`)
- [ ] Domain includes **search/filter tools** for every major entity (`find_customer`, `search_transactions`, `find_account`)

---

## Quick Reference

| Check | Principle | Critical? |
|-------|-----------|-----------|
| Domain operation name | Semantic Clarity | Yes |
| Trigger phrases (3-5) + when-NOT-to-use | Natural Language Compatibility | Yes |
| Structured money format (never float) | Structured Types | Yes |
| `data` + bounded response size | Rich Response Semantics | Yes |
| Available actions where state-dependent | Tool Graph | Recommended |
| Operation level assigned (+ MCP annotations) | Operation Levels | Yes |
| One confirmation layer for L3+ | Delegated Confirmations | Yes |
| Idempotency key for L3+ (server-generated) | Idempotency | Yes |
| No identity/credentials as parameters | Parameter Security (P11) | Yes |
| No sensitive data in response | Security | Yes |
| Search tools per entity | Search-First | Recommended |
| Voice-optimized format | Rich Semantics (voice only) | Recommended |
| Batch operations | Coverage | Recommended |
| Right-sized granularity | Granularity (catalog) | Recommended |
