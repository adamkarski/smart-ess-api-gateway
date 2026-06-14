#!/bin/bash
# Dodaje serwer Ollama (192.168.8.21) z auto-discovery modeli do opencode na Macu
# Nie usuwa istniejącej konfiguracji — merguje tylko nowy provider

set -e

CONFIG_DIR="$HOME/.config/opencode"
CONFIG_FILE="$CONFIG_DIR/opencode.json"
AUTH_FILE="$HOME/.local/share/opencode/auth.json"
PLUGIN="opencode-models-discovery@latest"
OLLAMA_URL="http://192.168.8.21:11434/v1"

echo "=== Setup Gemma4 + auto-discovery dla opencode ==="

# 1. Instaluj plugin
if npm list -g "$PLUGIN" &>/dev/null 2>&1; then
    echo "[OK] Plugin $PLUGIN już zainstalowany"
else
    echo "[...] Instaluje plugin $PLUGIN ..."
    npm install -g "$PLUGIN" 2>&1 | tail -1
    echo "[OK] Plugin zainstalowany"
fi

# 2. Auth
mkdir -p "$HOME/.local/share/opencode"
echo '{"ollama":{"type":"api","key":"ollama"}}' > "$AUTH_FILE"
echo "[OK] Auth zapisany"

# 3. Konfiguracja — merge przez Python (Mac ma go wbudowanego)
mkdir -p "$CONFIG_DIR"

python3 << 'PYEOF'
import json, os, sys

config_path = os.path.expanduser("~/.config/opencode/opencode.json")

ollama_provider = {
    "ollama": {
        "id": "ollama",
        "name": "Ollama (Linux 192.168.8.21)",
        "npm": "@ai-sdk/openai-compatible",
        "options": {
            "baseURL": "http://192.168.8.21:11434/v1",
            "apiKey": "ollama",
            "modelsDiscovery": {"enabled": True}
        }
    }
}

# Wczytaj istniejącą konfigurację lub stwórz nową
if os.path.exists(config_path):
    with open(config_path) as f:
        cfg = json.load(f)
    print("[OK] Wczytano istniejącą konfigurację")
else:
    cfg = {"$schema": "https://opencode.ai/config.json"}
    print("[OK] Nowa konfiguracja")

# Dodaj plugin jeśli nie istnieje
if "plugin" not in cfg:
    cfg["plugin"] = []
if "opencode-models-discovery@latest" not in cfg["plugin"]:
    cfg["plugin"].append("opencode-models-discovery@latest")
    print("[OK] Dodano plugin models-discovery")

# Merge/update provider — nadpisuje tylko klucz "ollama"
if "provider" not in cfg:
    cfg["provider"] = {}
cfg["provider"]["ollama"] = ollama_provider["ollama"]
print("[OK] Provider ollama zaktualizowany")

# Ustaw domyślny model na gemma4
cfg["model"] = "ollama/gemma4:e4b"
print("[OK] Domyślny model: ollama/gemma4:e4b")

with open(config_path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")

print(f"\n=== Konfiguracja zapisana ===")
print(f"Plik: {config_path}")
print(f"\nUruchom: opencode")
print(f"(przy starcie plugin przeskanuje API i wykryje wszystkie modele)")
PYEOF
