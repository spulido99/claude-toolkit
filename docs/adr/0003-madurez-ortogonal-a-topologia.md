# El maturity model mide disciplina de ingeniería, ortogonal a la topología

El maturity model de `evolution` trataba "más subagentes" como más madurez (Level 1 = agente único con 40-60 tools; migración L1→L2 = "crear 2-3 subagentes"). Decidimos que madurez = **disciplina de ingeniería de contexto, tools y evals, ortogonal a la topología**: bounded contexts empaquetados, progressive disclosure operando, contratos explícitos, suites de evals (tool-selection, HITL, disclosure) y telemetría de cache/latencia/tokens-por-episodio. Un agente único con skills y evals puede estar en Level 3-4; un sistema multi-agente sin evals ni telemetría es Level 1.

## Considered Options

- Rediseñar el formato completo del modelo — rechazado: los commands `/assess` y `/evolve` consumen la estructura de 4 niveles + scoring de 80 puntos; se conserva el formato y se re-basan las 8 dimensiones (fuera "número de subagentes"; entran topology-fit contra ADR-0001, disclosure, contratos, evals, telemetría).

## Consequences

La dimensión "topology-fit" puntúa si la topología coincide con el acoplamiento de escrituras — incluida la justificación económica de subagentes existentes (el valor del episodio paga el ~15× de tokens).
