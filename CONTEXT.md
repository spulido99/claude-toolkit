# Claude Toolkit

Colección de skills, plugins y commands para Claude Code. El vocabulario de este contexto gira alrededor de la guía de arquitectura de agentes que enseña el plugin deepagents-builder.

## Language

### Topología de agentes

**Acoplamiento de escrituras**:
Grado en que las escrituras de un episodio dependen de decisiones tomadas en el mismo hilo. Es la primera variable de decisión de topología: escrituras acopladas → un solo agente escribe; trabajo read-only paralelizable → subagentes valen.
_Avoid_: conteo de tools (como criterio de topología), "número de tools"

**Régimen de interacción**:
Propiedad descriptiva de un agente: `conversacional` (HITL constante, turnos cortos) o `autónomo` (episodios largos sin HITL). Describe el contexto de uso; NO decide la topología — eso lo hace el acoplamiento de escrituras.
_Avoid_: usar "conversacional vs autónomo" como criterio para partir en subagentes

**Episodio**:
Una unidad de trabajo del agente entre input humano y resultado: un turno conversacional o una corrida autónoma completa. "Deep" es propiedad del episodio, no del agente.

**Tool search**:
Descubrimiento y carga diferida de tools en el agente general: el agente arranca con un set mínimo y busca/carga el resto bajo demanda. Es la respuesta a catálogos grandes de tools (10+, o >10k tokens de definiciones) en la rama de agente único — nunca subagentes por conteo.
_Avoid_: "partir en subagentes porque hay muchas tools"

**Skill (como bound de dominio)**:
Bounded context empaquetado como SKILL.md con progressive disclosure: el índice ocupa una línea de contexto y el cuerpo se lee bajo demanda. Es la forma canónica de separar responsabilidades de dominio en un agente único.
_Avoid_: subagente-por-dominio en agentes conversacionales

**Patrón asistente**:
La forma canónica del agente conversacional profundo: frontal único con tools planas (tool search si el catálogo crece), HITL vía interrupts, bounds de dominio como skills, summarization para el horizonte largo, y deep workers en background para episodios read-heavy. Es el patrón de Claude, ChatGPT, Erica y Klarna.
_Avoid_: not-too-deep, "agente simple", chatbot (como nombre del patrón)

**Agente frontal**:
El rol que juega el asistente cuando despacha deep workers: el único agente que habla con el usuario y controla el hilo de escrituras.
_Avoid_: orquestador (implica multi-agente LLM), manager

**Deep worker**:
Episodio autónomo (típicamente read-heavy y paralelizable) despachado en background desde un agente frontal conversacional. El híbrido se modela como composición: frontal conversacional + deep workers, no como un tercer régimen.
