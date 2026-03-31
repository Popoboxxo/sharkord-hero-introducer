# Doorstop Requirements Management

This project uses [Doorstop](https://doorstop.readthedocs.io/) as a parallel requirements management tool alongside `docs/REQUIREMENTS.md`.

## Quick Start

```bash
# Install doorstop (once)
pip install doorstop

# Validate requirements tree
bun run reqs:validate
# or: doorstop

# Import/re-import from REQUIREMENTS.md → Doorstop YAML
bun run reqs:import
# or: py scripts/doorstop-import.py

# Publish to HTML / Markdown / CSV
bun run reqs:publish
# or: py scripts/doorstop-publish.py [html|md|csv|all]
```

## Document Tree

```
REQ (root)                    → reqs/
├── REQ-CORE (15 items)       → reqs/core/     Kernfunktionalität
├── REQ-CMD  (17 items)       → reqs/cmd/      Slash-Commands
├── REQ-CFG  (5 items)        → reqs/cfg/      Konfiguration / Settings
├── REQ-DATA (7 items)        → reqs/data/     Datenpersistenz
├── REQ-LIFE (4 items)        → reqs/life/     Plugin Lifecycle
├── REQ-NF   (4 items)        → reqs/nf/       Nichtfunktionale Anforderungen
├── REQ-DBG  (8 items)        → reqs/dbg/      Debug / Diagnose
└── REQ-AUTO (3 items)        → reqs/auto/     GitHub-Automatisierung
```

**Total: 63 requirements** (8 categories)

## Item Attributes

Each doorstop item (YAML file) contains:

| Attribute      | Type    | Description                                |
|----------------|---------|--------------------------------------------|
| `active`       | bool    | `false` for removed requirements           |
| `header`       | string  | Short title                                |
| `text`         | string  | Full requirement description               |
| `status`       | string  | `Implemented` / `Open` / `Removed`         |
| `priority`     | string  | `Must` / `Should` / `Could`                |
| `traceability` | string  | Source file(s) and line numbers             |
| `acceptance`   | string  | Acceptance criteria                        |
| `links`        | list    | Traceability links to parent items         |

## Workflow

### Adding a new requirement

```bash
# Via doorstop CLI (e.g., new CORE requirement)
doorstop add REQ-CORE

# Then edit the generated YAML file
# Also update docs/REQUIREMENTS.md to keep both in sync
```

### Editing an existing requirement

Edit the YAML file directly in `reqs/<category>/REQ-<CATEGORY>-<NNN>.yml` and validate:

```bash
doorstop
```

### Re-importing from REQUIREMENTS.md

If `docs/REQUIREMENTS.md` is the source of truth and you want to regenerate all doorstop items:

```bash
bun run reqs:import    # WARNING: Overwrites all reqs/ YAML files
```

### Publishing

```bash
bun run reqs:publish           # All formats (HTML + MD + CSV)
py scripts/doorstop-publish.py html   # HTML only
py scripts/doorstop-publish.py md     # Markdown only
```

Generated outputs go to `docs/requirements-doorstop/` (HTML) and `docs/doorstop-*.md` (Markdown). These are git-ignored.

## File Structure

```
reqs/                          # Doorstop YAML items (committed to git)
├── .doorstop.yml              # Root document config
├── REQ-001.yml ... REQ-008.yml # Category anchor items
├── core/
│   ├── .doorstop.yml          # REQ-CORE document config
│   └── REQ-CORE-001.yml ...   # Individual requirements
├── cmd/
├── cfg/
├── data/
├── life/
├── nf/
├── dbg/
└── auto/
scripts/
├── doorstop-import.py         # REQUIREMENTS.md → Doorstop import
└── doorstop-publish.py        # Doorstop → HTML/MD/CSV export
docs/
├── REQUIREMENTS.md            # Primary source of truth (manual)
├── requirements-doorstop/     # Generated HTML (git-ignored)
└── doorstop-*.md              # Generated Markdown (git-ignored)
```
