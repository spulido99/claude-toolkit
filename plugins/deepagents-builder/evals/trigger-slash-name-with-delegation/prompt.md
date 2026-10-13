---
max_turns: 4
runs: 2
allowed_tools: [Read, Glob, Grep, Skill]
tags: [trigger]
---

El agente corre en AWS Bedrock AgentCore y está hecho en deepagents de langchain, siguiendo la guía de agentes de /deepagents-builder (dile a un sub agente que revise el skill si necesitas). Propón la topología del agente de backoffice que revisa solicitudes de crédito.
