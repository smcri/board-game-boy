# ADR-0001 — Use lightweight ADRs for material decisions

- **Status:** Accepted
- **Date:** 2026-05-17
- **Deciders:** Project author + LLM design partner

## Context

The Agentic Board Game Builder makes a large number of architectural decisions
(framework choice, state model, DSL shape, hosting target, etc.). Many of these
have multiple defensible alternatives, and the chosen option only makes sense
in the context of the trade-offs that were considered and rejected.

`docs/design/0X-*.md` documents capture the *current* architecture as a coherent
whole. They are revised as the architecture evolves. We also need a place to
record point-in-time *decisions* — what was chosen, what was rejected, and why —
so that future contributors (and future us) can see how we got here without
having to spelunk the git history.

This is the canonical use case for Architecture Decision Records (ADRs).

## Decision

We will use lightweight Markdown ADRs stored under `docs/decisions/`.

- Filename format: `ADR-NNNN-kebab-case-title.md` with monotonically increasing 4-digit numbers.
- Template (this very file is the template):
  - Title line: `# ADR-NNNN — <short, decision-shaped statement>`
  - Metadata: Status, Date, Deciders
  - Sections: Context, Decision, Consequences, Alternatives considered, References
- Statuses: `Proposed`, `Accepted`, `Deprecated`, `Superseded by ADR-NNNN`.
- Scope: anything that changes the architecture, the build/runtime contract,
  the deployment story, or any cross-cutting policy (security, observability,
  data retention, etc.). Trivial implementation choices do **not** need an ADR.
- ADRs are immutable once `Accepted`. To change a decision, write a new ADR
  that supersedes the old one and update the old one's status.

## Consequences

- Decisions are discoverable in one place.
- Reviewers can challenge a decision by writing a counter-ADR rather than
  rewriting prose buried inside design docs.
- Light overhead — one Markdown file per decision, no tooling required.
- Design docs (`docs/design/`) remain the system-level view; ADRs are the
  audit trail of how it became that way.

## Alternatives considered

- **No ADRs; rely on git history.** Rejected — git history is hard to navigate
  for design rationale and is invisible from the docs.
- **One giant CHANGELOG.md of decisions.** Rejected — does not scale; reviewers
  can't link to a single decision; merge conflicts on every change.
- **Heavyweight RFC process (e.g., Rust RFCs).** Rejected — over-scope for a
  small project; we want a low-ceremony record, not a community review process.
- **Wiki / Confluence.** Rejected — keep decisions next to the code they describe.

## References

- Michael Nygard, *Documenting Architecture Decisions* (2011).
- `docs/design/00-index.md` — the architecture overview these ADRs underpin.
