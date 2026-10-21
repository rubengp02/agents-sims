# Third-party code adapted for local team execution

## Claw-Empire

Project: https://github.com/GreenSheep01201/claw-empire

Revision: `66a24ea7df2435ef897c48c147deb7ec572c01c2`.

Original file: `server/modules/workflow/core/cli-tools.ts`, function
`buildAgentArgs`, Claude branch.

The Claude argument construction in
`server/src/execution/officialCliArguments.ts` is adapted from that implementation
under the Apache License, Version 2.0. A copy is included at
`licenses/Claw-Empire-Apache-2.0.txt`.

Modifications: remove permission bypass, reduce maximum turns, add safe mode,
strict empty MCP configuration, disabled customization sources/browser/session
persistence, explicit effort and allowed tools. The subscription gate is separate
and currently blocks Claude inference because additional usage cannot be verified
before execution through a documented official CLI interface.

Claw-Empire's separation of tasks, agent roles and execution events informed our
new local queue. Its credential readers, direct HTTP provider requests, API/OAuth
storage, autonomous meetings and UI artwork were not incorporated.

The rest of the existing Pixel Office project retains its original notices.

## Agent Orchestrator

Project: https://github.com/OrchestratorInc/agent-orchestrator

Revision: `1550d440b82ac9cfb3e671b060709457cdffbaea`, Apache License 2.0.
A copy is included at `licenses/Agent-Orchestrator-Apache-2.0.txt`.

`integrations/agent-orchestrator/` builds a restricted bridge against the original
native Codex conversation driver and Git worktree adapter. `office_driver.go`
adds an opt-in constructor and adapts the original `spawnAppServer` pipe lifecycle:
it fixes the official provider, disables plugins and nested agents, and keeps the
provider tied to the owned bridge process. Original source files remain unchanged.
The official source checkout and compiled binaries stay in ignored local storage.
No upstream desktop artwork is incorporated. No account-switching, credit-reset,
cloud, automatic-review or scheduled-execution service is exposed by the bridge.
