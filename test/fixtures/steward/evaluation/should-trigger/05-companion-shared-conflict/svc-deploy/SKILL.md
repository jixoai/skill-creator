---
name: svc-deploy
description: Roll the service out to the canary pool.
allowed-tools: Bash
---

# svc-deploy

Executes `scripts/service.sh deploy canary` and waits for health checks.
