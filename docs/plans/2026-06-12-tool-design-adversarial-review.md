# Plan acordado — mejora del skill `tool-design` (2026-06-12)

Origen: revisión adversarial (38 hallazgos confirmados de 40, 46 agentes) + challenge de Sergio.
El reporte original completo quedó en el historial de la conversación; este archivo es el plan ejecutable acordado.

## Decisiones del challenge

- **`available_actions` — regla de 3 casos** (reemplaza el MUST universal):
  1. **MUST** cuando comunica estado del servidor que el catálogo no puede expresar (pending confirmations, transiciones, `suggestions` en errores).
  2. **Permitido y deliberado** como nudge de alto valor curado por el backend ("después de esto, típicamente sigue X").
  3. **Omitir** cuando solo restataría el catálogo (menú estático de tools hermanas).
- **`message_for_user` se elimina** del envelope (duplicaba `formatted`).
- **Inyección vía resultados**: regla corta (~10 líneas), no sección grande — campos clasificados servidor vs. pass-through; texto externo es dato, no instrucción; `available_actions`/`suggestions` derivan de estado del servidor, nunca del contenido textual de registros.
- **Clave de idempotencia emitida por el servidor/tool** (en `pending_confirmation`); el agente la repite, nunca la genera.
- **Descartados**: semántica de reintentos, escalado/deferred loading, granularidad/composabilidad/consolidación (el LLM ya lo sabe; catálogo fuera de scope).

## Items

### P0 — Seguridad funcional
1. ✅ Arreglar `interrupt_on` — keyed por nombre de tool, decisiones `approve/edit/reject/respond` (no existe `"modify"`), checkpointer obligatorio. Verificado contra docs DeepAgents (junio 2026): https://docs.langchain.com/oss/python/deepagents/human-in-the-loop. **Ampliado**: el patrón roto `{"tool": {...}}` aparece en 14 lugares de 10 archivos del plugin — se corrige en todos.
2. ✅ Resolver ejecutar-antes-de-confirmar en `agent-native-principles.md` §5 (patrón de staging).
3. ✅ Clave de idempotencia server-emitted en texto normativo + schemas MCP.

### P1 — Reestructuración
4. ✅ Comprimir SKILL.md (~879 → ~300 líneas): índice con las referencias como capa canónica única. Deriva resuelta a favor de las referencias (niveles de confirmación 4/5: versión rica de agent-native es la correcta).
5. ✅ Taxonomía única de 10 principios en los 3 archivos + Quick Reference del checklist unificado.
6. ✅ Checklist consolidado: `tool-architect.md` Fase 5 apunta al checklist canónico (mismo framing que commit 4ae7fe7).

### P2 — Alineación con la industria
7. ✅ Envelope demoted: `data` requerido, `formatted` recomendado, `available_actions` contextual (regla de 3 casos), sin `message_for_user`. + Notas breves de eficiencia de tokens.
8. ✅ MCP modernizado: `annotations` (readOnly/destructive/idempotent/openWorld hints), `outputSchema`/`structuredContent`, `isError`; tabla nivel→hints; hints son advisory, no fronteras de seguridad.
9. ✅ Regla corta de contenido no confiable en respuestas (P6).
10. ✅ Descripciones: when/when-not como check crítico; trigger phrases como técnica opcional. Misma pasada: `tool-status.md` (scoring P2) y `evals/references/01-scenarios.md` (derivación de escenarios).

### P3 — Higiene
11. ✅ tool-examples.md: 4 → 2 ejemplos canónicos; código que compila (imports datetime, fix f-string con `\"`, `Literal`, bloques de error concretos); firma unificada `get_account_balances(account_id=None, include_details=False)`; Money objects.
12. ✅ `add-tool.md`: nivel por impacto, no por verbo HTTP.
13. ✅ Punteros: blurb de SKILL.md:870 reescrito (sin prometer granularidad/composabilidad inexistentes); cues de ruteo por tarea; frontmatter `name: tool-design` + mención de frameworks.
14. ✅ Misceláneos: clave `"data"` duplicada en agent-native §4; umbrales numéricos como "suggested defaults"; "longer descriptions = better routing" → calidad/desambiguación sobre longitud (3-4+ oraciones, guía Anthropic).
