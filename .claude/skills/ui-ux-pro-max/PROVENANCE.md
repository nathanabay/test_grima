# Provenance

Vendored from https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
at commit `d9062e3bc26e10e3d4d63b5b23542202e8d9efce` (2026-09-03), MIT licensed.

Only the `ui-ux-pro-max` skill was taken. The upstream repository also ships
`design`, `ui-styling`, `design-system`, `brand`, `slides` and `banner-design`;
those were left out because this project already has its own design system
(`specs/DESIGN_SYSTEM.md`, `apps/web/app/globals.css`) and a second opinion on
tokens would compete with it rather than help.

## What was checked before vendoring

`scripts/core.py` and `scripts/search.py` were read for network calls,
subprocess use, `eval`/`exec`, and environment or credential access. There are
none: the scripts are a local search over the JSON and CSV data bundled
alongside them. The only thing the skill asks to be run is

    python .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <domain>

which reads those bundled files and prints results.

## Updating

Re-clone upstream, re-read the two scripts for the same things, and copy the
`ui-ux-pro-max` directory over this one. Record the new commit above.
