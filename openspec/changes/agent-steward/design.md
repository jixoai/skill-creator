# Design: agent-steward

```text
Manager Skill Intelligence report
          |
          v
    Agent steward run
          |
    +-----+------+----------------+
    |            |                |
  analyze     recommend        draft patch
                                     |
                              validate + approve
                                     |
                                     v
                              Manager apply
```

Agent steward owns orchestration of analysis and proposals. Adapter owns only process launch, protocol mapping and capability declaration. Manager owns target resolution, draft apply, validation, approval, provenance and audit.

Selection is an explicit configuration choice. No silent fallback from one backend to another, because a fallback can change model, tool, sandbox or permission semantics. A run stores the input Skill IDs, observed revisions, findings, proposal IDs, permission decisions and terminal status.

## Demo reference

`demo/agent-steward.html` is a standalone reference for a normalized run timeline, recommendation queue, backend capability status, cancellation, and the approval gate. It is not an adapter or a working Agent run; production implementation must use the Manager authority boundary and real lifecycle tests.
