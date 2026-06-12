import tinytuya
import json
import time
import os

DB_FILE = 'tuya_devices_db.json'

def update_db_ip(device_id, ip, version):
    if not os.path.exists(DB_FILE):
        return
    
    try:
        with open(DB_FILE, 'r') as f:
            db = json.load(f)
        
        updated = False
        for dev in db.get('devices', []):
            if dev['id'] == device_id:
                if dev.get('ip') != ip or dev.get('version') != version:
                    dev['ip'] = ip
                    dev['version'] = version
                    updated = True
                    print(f"DEBUG: Updated {dev['name']} -> IP: {ip}, v: {version}")
        
        if updated:
            with open(DB_FILE, 'w') as f:
                json.dump(db, f, indent=2)
    except Exception as e:
        print(f"DEBUG: Error updating DB: {e}")

def monitor():
    print("🚀 Starting Background Tuya IP Monitor...")
    print("Listening for broadcasts (CTRL+C to stop)...")
    
    # deviceScan in a loop to catch devices as they wake up
    while True:
        try:
            # maxretry=1 makes it check quickly and move on
            devices = tinytuya.deviceScan(verbose=False, maxretry=1, byID=True)
            if devices:
                for dev_id, info in devices.items():
                    update_db_ip(dev_id, info['ip'], info.get('version', '3.3'))
            
            time.sleep(10) # Wait 10 seconds before next scan loop
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"DEBUG: Monitor error: {e}")
            time.sleep(30)

if __name__ == "__main__":
    monitor()
