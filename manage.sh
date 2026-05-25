#!/bin/bash

# desmonitor service management script for macOS

# Get the absolute path of the project directory
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PLIST_NAME="com.desmonitor.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"
NODE_BIN=$(which node)

if [ -z "$NODE_BIN" ]; then
    NODE_BIN="/usr/local/bin/node"
fi

# Ensure logs directory exists
mkdir -p "$PROJECT_DIR/logs"

get_url() {
    local port=$(grep "^PORT=" "$PROJECT_DIR/.env" | cut -d'=' -f2)
    if [ -z "$port" ]; then
        port="8000"
    fi
    echo "http://localhost:$port"
}

is_loaded() {
    launchctl list | grep -q "com.desmonitor"
}

case "$1" in
  setup)
    echo "Creating launchd plist at $PLIST_PATH..."
    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.desmonitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$PROJECT_DIR/dist/main.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$PROJECT_DIR/logs/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$PROJECT_DIR/logs/stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
EOF
    if is_loaded; then
        launchctl unload "$PLIST_PATH"
    fi
    echo "Loading service..."
    launchctl load "$PLIST_PATH"
    echo "Service installed and started at $(get_url)"
    ;;
  start)
    if [ ! -f "$PLIST_PATH" ]; then
        echo "Plist not found. Running setup first..."
        $0 setup
    elif is_loaded; then
        echo "Service is already running at $(get_url)"
    else
        launchctl load "$PLIST_PATH"
        echo "Service started at $(get_url)"
    fi
    ;;
  stop)
    if is_loaded; then
        launchctl unload "$PLIST_PATH"
        echo "Service stopped."
    else
        echo "Service is not running."
    fi
    ;;
  restart)
    if [ ! -f "$PLIST_PATH" ]; then
        $0 setup
    else
        if is_loaded; then
            launchctl unload "$PLIST_PATH"
        fi
        launchctl load "$PLIST_PATH"
        echo "Service restarted at $(get_url)"
    fi
    ;;
  status)
    if is_loaded; then
        launchctl list | grep com.desmonitor
        echo "Service is running at $(get_url)"
    else
        echo "Service is not loaded."
    fi
    ;;
  logs)
    tail -f "$PROJECT_DIR/logs/stdout.log" "$PROJECT_DIR/logs/stderr.log"
    ;;
  *)
    echo "Usage: $0 {setup|start|stop|restart|status|logs}"
    exit 1
esac
