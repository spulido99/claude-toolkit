---
type: regex
target: trace
pattern: '"(skill|subagent_type)":"deepagents-builder:[\w-]+"'
---

Passes when the session loads a plugin skill (Skill tool) or delegates to a plugin agent (Agent tool).
