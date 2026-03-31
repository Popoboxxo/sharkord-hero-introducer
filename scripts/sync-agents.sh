#!/usr/bin/env bash
# sync-agents.sh
# Synchronisiert .claude/agents/ → .github/agents/ (Copilot-Format)
# Wird automatisch als Git Pre-Commit Hook ausgeführt.

set -euo pipefail

CLAUDE_DIR=".claude/agents"
COPILOT_DIR=".github/agents"

# Tool-Mapping: Claude Code Tools → GitHub Copilot Tools
# Wird pro Agent als statische Zuordnung definiert
declare -A AGENT_TOOLS
AGENT_TOOLS["hero-introducer"]="['vscode', 'execute', 'read', 'agent', 'edit', 'search', 'web', 'todo']"
AGENT_TOOLS["hi-developer"]="['vscode', 'execute', 'read', 'agent', 'edit', 'search', 'todo']"
AGENT_TOOLS["hi-documenter"]="['read', 'edit', 'search', 'todo']"
AGENT_TOOLS["hi-requirements"]="['read', 'edit', 'search', 'todo']"
AGENT_TOOLS["hi-tester"]="['vscode', 'execute', 'read', 'agent', 'edit', 'search', 'todo']"
AGENT_TOOLS["hi-validator"]="['read', 'search', 'execute', 'todo']"

# Argument-Hints pro Agent
declare -A AGENT_HINTS
AGENT_HINTS["hero-introducer"]="Feature-Anforderung, Bugfix, Test, Validierung, Doku-Update, oder Docker-Testsystem starten"
AGENT_HINTS["hi-developer"]="REQ-xxx implementieren, Bugfix beschreiben, oder Refactoring-Aufgabe"
AGENT_HINTS["hi-documenter"]="Doku aktualisieren, Erkenntnisse speichern, Codebase Overview updaten, oder README pflegen"
AGENT_HINTS["hi-requirements"]="Neue Anforderung beschreiben, bestehende REQ-ID prüfen, oder Traceability-Analyse anfordern"
AGENT_HINTS["hi-tester"]="Tests für REQ-xxx schreiben, Testabdeckung prüfen, Test-Suite ausführen, oder Docker-Testsystem starten"
AGENT_HINTS["hi-validator"]="Validierung einer Implementierung, DoD-Check, Traceability-Audit, Code-Review gegen REQ-IDs, manueller E2E-Test aller Commands"

echo "🔄 Synchronisiere Claude Agents → GitHub Copilot Agents..."

mkdir -p "$COPILOT_DIR"

for claude_file in "$CLAUDE_DIR"/*.md; do
  [ -f "$claude_file" ] || continue

  # Agent-Name aus Dateiname ableiten
  filename=$(basename "$claude_file" .md)
  copilot_file="$COPILOT_DIR/${filename}.agent.md"

  # Name und Description aus Claude-Frontmatter extrahieren
  name=$(awk '/^---/{f++} f==1 && /^name:/{print; exit}' "$claude_file" | sed 's/^name: *//')
  description=$(awk '/^---/{f++} f==1 && /^description:/{print; exit}' "$claude_file" | sed 's/^description: *//' | tr -d '"')

  # Tools und Hint aus Mapping
  tools="${AGENT_TOOLS[$filename]:-['read', 'edit', 'search']}"
  hint="${AGENT_HINTS[$filename]:-}"

  # Body extrahieren (alles nach dem zweiten ---)
  body=$(awk '/^---/{f++; if(f==2){found=1; next}} found{print}' "$claude_file")

  # Copilot-Datei schreiben
  {
    echo "---"
    echo "name: ${name}"
    echo "description: \"${description}\""
    echo "argument-hint: \"${hint}\""
    echo "tools: ${tools}"
    echo "---"
    echo ""
    echo "${body}"
  } > "$copilot_file"

  echo "  ✅ ${copilot_file}"
done

echo "✅ Sync abgeschlossen: ${COPILOT_DIR}/"
