#!/bin/bash
# Konfiguracja opencode na Macu — Ollama + llama.cpp (qwen3.6 MoE)
# Uruchomić na Macu: bash /path/to/setup_opencode_mac.sh

set -e

CONFIG_DIR="$HOME/.config/opencode"
CONFIG_FILE="$CONFIG_DIR/opencode.json"
AUTH_FILE="$HOME/.local/share/opencode/auth.json"
PLUGIN="opencode-models-discovery@latest"

echo "=== Setup opencode: Ollama + llama.cpp (192.168.8.21) ==="

# 1. Auth
mkdir -p "$HOME/.local/share/opencode"
echo '{"ollama":{"type":"api","key":"ollama"}}' > "$AUTH_FILE"
echo "[OK] Auth zapisany"

# 2. Plugin auto-discovery (dla Ollamy)
if npm list -g "$PLUGIN" &>/dev/null 2>&1; then
    echo "[OK] Plugin $PLUGIN już zainstalowany"
else
    echo "[...] Instaluje plugin $PLUGIN ..."
    npm install -g "$PLUGIN" 2>&1 | tail -1
    echo "[OK] Plugin zainstalowany"
fi

# 3. Konfiguracja — przepisuje cały plik (bezpieczniej niż merge)
mkdir -p "$CONFIG_DIR"

cat > "$CONFIG_FILE" << 'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "ollama/gemma4:e4b",
  "plugin": [
    "opencode-models-discovery@latest"
  ],
  "provider": {
    "ollama": {
      "id": "ollama",
      "name": "Ollama (Linux 192.168.8.21)",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://192.168.8.21:11434/v1",
        "apiKey": "ollama",
        "modelsDiscovery": {
          "enabled": true
        }
      }
    },
    "llama": {
      "id": "llama",
      "name": "llama.cpp (192.168.8.21, qwen3.6 MoE)",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://192.168.8.21:8081/v1",
        "apiKey": "ollama"
      },
      "models": {
        "qwen3.6": {
          "name": "Qwen3.6 35B-A3B MoE (primary, 256K ctx)",
          "limit": { "context": 256000, "output": 32768 },
          "tool_call": true
        }
      }
    }
  }
}
EOF

echo "[OK] Konfiguracja zapisana: $CONFIG_FILE"
echo "[OK] Domyślny model: ollama/gemma4:e4b"
echo ""
echo "Gdy llama.cpp (qwen3.6) będzie uruchomiony, zmień model na:"
echo "  llama/qwen3.6"
echo ""
echo "Uruchom: opencode"
