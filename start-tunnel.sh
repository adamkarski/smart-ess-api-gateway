#!/bin/bash
LOGFILE=/Users/tosh/Desktop/desmonitor/logs/tunnel.log
URLFILE=/Users/tosh/Desktop/desmonitor/logs/tunnel-url.txt

echo "--- Starting cloudflared tunnel at $(date) ---" >> "$LOGFILE"

cloudflared tunnel --protocol http2 --url http://localhost:8000 >> "$LOGFILE" 2>&1 &
CLOUDFLARED_PID=$!

# Wait for URL to appear and save it
for i in $(seq 1 30); do
    sleep 2
    URL=$(grep -o 'https://[^ ]*\.trycloudflare\.com' "$LOGFILE" | head -1)
    if [ -n "$URL" ]; then
        echo "$URL" > "$URLFILE"
        echo "Tunnel URL: $URL" >> "$LOGFILE"
        break
    fi
done

wait $CLOUDFLARED_PID
