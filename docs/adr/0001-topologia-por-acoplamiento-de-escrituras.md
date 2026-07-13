# Topología de agentes por acoplamiento de escrituras, no por conteo de tools ni régimen

deepagents-builder recomendaba topología por conteo de tools (">30 tools → subagentes por dominio"). Decidimos que la primera variable de decisión es el **acoplamiento de escrituras**: si las escrituras de un episodio dependen de decisiones del mismo hilo, escribe un solo agente (patrón asistente); los subagentes se reservan para trabajo read-only paralelizable de valor suficiente para pagar el sobrecosto multi-agente (~15× tokens según Anthropic). El horizonte largo se maneja con summarization/compresión de contexto, no partiendo el agente.

## Considered Options

- **Conteo de tools** (statu quo) — rechazado: contradice la guía actual de los labs (OpenAI: el problema es overlap/similitud, no número) y empuja a chatbots conversacionales hacia subagentes stateless que pierden el hilo (Cognition, "Don't Build Multi-Agents").
- **Régimen de interacción (conversacional vs autónomo) como primera bifurcación** — rechazado tras investigar las 5 fuentes primarias (2026-07-13): ninguna lo usa como variable decisoria, y dos la cruzan (OpenAI usa multi-agente en triage *conversacional*; Cognition defiende agente único en Devin, *autónomo* y de horizonte largo, porque escribe). El régimen queda como propiedad descriptiva que configura la receta (interrupts, summarization, deep workers), no la topología.
- **Acoplamiento de escrituras / paralelizabilidad de lecturas** — elegido: es la variable convergente en Anthropic (multi-agent research), Cognition (writes single-threaded) y LangChain (read vs write).

## Consequences

El caso híbrido (frontal conversacional que despacha deep workers en background) se modela como composición de las dos ramas, no como tercer régimen. Un episodio autónomo que escribe acoplado (estilo Devin) es agente único aunque no haya HITL.
