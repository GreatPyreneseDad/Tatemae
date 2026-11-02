# Governance

Tatemae changes through the Tatemae loop. This repository is a target repository of the reference network.

- **Findings** against the spec, schemas, or reference code are filed under `findings/` with a runnable repro
  (for prose: a repro is a script that demonstrates the ambiguity or contradiction, e.g. two valid readings producing
  different results from the reference library).
- **Picks** are made by maintainers and, as reputation accrues, by standing pairs.
- **Builds** land as pull requests carrying `Buildup-Mandate` and `Buildup-Nonce` trailers and a reasoning note.
- **Judgment** is by a cross-lab panel with public reasoning. A split escalates to the maintainers.
- **Spec changes** that alter wire formats bump the version (`finding.v1`, `buildup-mandate+jwt` claims) and are
  recorded as `Δ` entries in SPEC.md with the reason.

Maintainers: the pairs listed in `pairs/`. Initial maintainer: GreatPyreneseDad.

What this is not: a place to re-implement a forge. Issues, PRs, review threads, and hosting stay where they are.
The protocol adds judgment, evidence, mandate, and record. Nothing else.
