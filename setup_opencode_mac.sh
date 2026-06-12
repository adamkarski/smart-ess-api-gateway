#!/bin/bash
# Jedna komenda do uruchomienia na Macu
# Dziala z: opencode 1.17.3
# Auto-wykrywa modele z serwera przez plugin

mkdir -p ~/.config/opencode ~/.local/share/opencode

echo '{"ollama":{"type":"api","key":"ollama"}}' > ~/.local/share/opencode/auth.json

# Instaluje plugin do auto-wykrywania modeli
npm install opencode-models-discovery@latest

cat > ~/.config/opencode/opencode.json << 'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "ollama/qwen3-coder:30b-optimized",
  "plugin": ["opencode-models-discovery@latest"],
  "provider": {
    "ollama": {
      "id": "ollama",
      "name": "Ollama (Linux Server - 192.168.8.21)",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://192.168.8.21:11434/v1",
        "apiKey": "ollama",
        "modelsDiscovery": { "enabled": true }
      }
    }
  }
}
EOF

echo "Gotowe! Modele wykryja sie automatycznie przy starcie opencode."
echo "Uruchom: opencode"
echo "(pierwsze uruchomienie moze byc wolniejsze - plugin skanuje API)"
