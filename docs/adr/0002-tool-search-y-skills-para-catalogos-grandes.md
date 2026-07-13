# Catálogos grandes de tools se resuelven con tool search y skills, no con subagentes

Cuando un agente único acumula muchas tools, la respuesta era partirlo en subagentes (anti-patrón "God Agent" definido como ">30 tools"). Decidimos que en la rama de agente único las tools se quedan en el agente general: catálogos de 10+ tools (o >10k tokens de definiciones — umbrales documentados por Anthropic para su Tool Search Tool) se manejan con **tool search / carga diferida**, y los bounded contexts de responsabilidades se separan como **skills** (SKILL.md con progressive disclosure), no como subagentes. "God Agent" se redefine: el anti-patrón es *catálogo grande sin mecanismo de disclosure y con overlap de nombres*; la cura es primero tool design (consolidar/renombrar), luego tool search, y subagentes solo si tras eso queda trabajo read-only paralelizable (ADR-0001).

## Consequences

- En deepagents 0.6 no hay tool search nativo: se compone vía `middleware=` con `ProviderToolSearchMiddleware` (Anthropic/OpenAI server-side) o `LLMToolSelectorMiddleware` (fallback provider-agnóstico), manteniendo las built-ins (filesystem, task, todos) no diferidas.
- La biblioteca de skills es superficie de prompt injection: protegerla con `permissions` deny-write.
- Los checks de `/validate-agent` y `code-reviewer` pasan de "¿>30 tools? → flag" a "¿10+ tools sin tool search/skills? → flag".
