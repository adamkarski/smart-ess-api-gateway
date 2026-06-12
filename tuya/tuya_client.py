import tinytuya
import json
import sys
import time
import os

# Cloud Credentials: env vars with fallback to hardcoded values
API_KEY = os.environ.get('TUYA_API_KEY') or 'xmdyfty4pwshcp4nwmtq'
API_SECRET = os.environ.get('TUYA_API_SECRET') or '2acf28fd1f474a1b932fc93f10ff30d0'
REGION = os.environ.get('TUYA_REGION') or 'eu'

def is_local_ip(ip):
    if not ip: return False
    # Common local IP ranges
    return ip.startswith('192.168.') or ip.startswith('10.') or ip.startswith('172.')

def sync():
    """Update tuya_devices_db.json and automate tinytuya configuration"""
    try:
        # Create tinytuya.json automatically if it doesn't exist
        config = {
            "apiKey": API_KEY,
            "apiSecret": API_SECRET,
            "apiRegion": REGION,
            "apiDeviceID": "scan"
        }
        with open('tinytuya.json', 'w') as f:
            json.dump(config, f, indent=4)

        # Get device list from cloud
        c = tinytuya.Cloud(apiRegion=REGION, apiKey=API_KEY, apiSecret=API_SECRET)
        
        # Use a more comprehensive way to get devices with mappings
        cloud_devices = c.getdevices(True) # True means get DP mappings too
        
        if isinstance(cloud_devices, dict) and 'result' in cloud_devices:
            cloud_devices = cloud_devices['result']
        
        if not isinstance(cloud_devices, list):
             print(f"ERROR: Failed to get device list: {cloud_devices}")
             sys.exit(1)

        # Scan for local devices to get IPs
        print("Scanning for local devices to find IPs...")
        scanned_data = tinytuya.deviceScan(byID=True, maxretry=15)
        
        # Merge scan data (IPs) into device list
        for dev in cloud_devices:
            dev_id = dev['id']
            # Prioritize locally scanned IP
            if scanned_data and dev_id in scanned_data:
                dev['ip'] = scanned_data[dev_id]['ip']
                if 'version' in scanned_data[dev_id]:
                    dev['version'] = scanned_data[dev_id]['version']
                print(f"Found IP for {dev['name']}: {dev['ip']} (v{dev.get('version', '3.x')})")
            else:
                # Check if the IP from cloud is local. If not, set to None
                cloud_ip = dev.get('ip')
                if not is_local_ip(cloud_ip):
                    dev['ip'] = None
                print(f"Device {dev['name']} - Cloud IP: {cloud_ip} (Local: {is_local_ip(cloud_ip)})")

        result = {
            'lastSync': time.ctime(),
            'devices': cloud_devices
        }
        with open('tuya_devices_db.json', 'w') as f:
            json.dump(result, f, indent=2)
        print(f"SUCCESS: Synced {len(cloud_devices)} devices")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"ERROR: Exception during sync: {str(e)}")
        sys.exit(1)

def control(device_id, ip, local_key, dps_index, value, version=3.3):
    """Control a device locally"""
    try:
        if isinstance(value, str):
            if value.lower() == 'true': value = True
            elif value.lower() == 'false': value = False
        
        try: version = str(version) # tinytuya works better with string versions for 3.4+
        except: version = "3.3"

        d = tinytuya.OutletDevice(device_id, ip, local_key)
        d.set_version(float(version))
        
        payload = d.generate_payload(tinytuya.CONTROL, {str(dps_index): value})
        status = d.send(payload)
        
        if isinstance(status, dict) and ('Error' in status or 'Err' in status):
             print(json.dumps({"error": status.get('Error', 'Unknown Error'), "code": status.get('Err', '999')}))
        else:
             print(json.dumps({"success": True, "response": status}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

def status(device_id, ip, local_key, version=3.3):
    """Get device status locally"""
    try:
        try: version = str(version)
        except: version = "3.3"
            
        d = tinytuya.OutletDevice(device_id, ip, local_key)
        d.set_version(float(version))
        data = d.status()
        
        if isinstance(data, dict) and ('Error' in data or 'Err' in data):
             print(json.dumps({"error": data.get('Error', 'Unknown Error'), "code": data.get('Err', '999')}))
        else:
             print(json.dumps(data))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

def get_mapping(device_id):
    """Fetch DP mapping for a device from cloud"""
    try:
        c = tinytuya.Cloud(apiRegion=REGION, apiKey=API_KEY, apiSecret=API_SECRET)
        devices = c.getdevices(True)
        if isinstance(devices, dict) and 'result' in devices:
            devices = devices['result']
        for dev in devices:
            if dev.get('id') == device_id:
                return dev.get('mapping', {})
    except:
        pass
    return {}

def cloud_control(device_id, dps_index, value):
    """Control a device via Tuya Cloud API"""
    try:
        if isinstance(value, str):
            if value.lower() == 'true': value = True
            elif value.lower() == 'false': value = False

        c = tinytuya.Cloud(apiRegion=REGION, apiKey=API_KEY, apiSecret=API_SECRET)

        # Get mapping to find the code name for this DPS index
        mapping = get_mapping(device_id)
        code = None
        if mapping and str(dps_index) in mapping:
            code = mapping[str(dps_index)].get('code')
        
        # Build command: use code name if available, otherwise use dps_index
        commands = {
            "commands": [
                {"code": code or str(dps_index), "value": value}
            ]
        }
        data = c.sendcommand(device_id, commands)
        if isinstance(data, dict) and data.get('success'):
            print(json.dumps({"success": True, "response": data}))
        else:
            print(json.dumps({"error": data.get('msg', 'Unknown error'), "code": data.get('code', '999')}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

def cloud_status(device_id):
    """Get device status from Tuya Cloud"""
    try:
        c = tinytuya.Cloud(apiRegion=REGION, apiKey=API_KEY, apiSecret=API_SECRET)
        data = c.getstatus(device_id)
        print(json.dumps(data))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

def cloud_shadow(device_id):
    """Get device shadow properties (IoT Data Model V2.0) — returns sensor data for cloud-only devices"""
    try:
        c = tinytuya.Cloud(apiRegion=REGION, apiKey=API_KEY, apiSecret=API_SECRET)
        data = c.cloudrequest(f'/v2.0/cloud/thing/{device_id}/shadow/properties')
        print(json.dumps(data))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 tuya_client.py [sync|control|status|cloud_status|cloud_control] ...")
        sys.exit(1)
        
    cmd = sys.argv[1]
    
    if cmd == "sync":
        sync()
    elif cmd == "control":
        if len(sys.argv) < 7:
            print("Usage: python3 tuya_client.py control <id> <ip> <key> <dps> <value> [version]")
            sys.exit(1)
        version = sys.argv[7] if len(sys.argv) > 7 else 3.3
        control(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6], version)
    elif cmd == "status":
        if len(sys.argv) < 5:
            print("Usage: python3 tuya_client.py status <id> <ip> <key> [version]")
            sys.exit(1)
        version = sys.argv[5] if len(sys.argv) > 5 else 3.3
        status(sys.argv[2], sys.argv[3], sys.argv[4], version)
    elif cmd == "cloud_status":
        if len(sys.argv) < 3:
            print("Usage: python3 tuya_client.py cloud_status <id>")
            sys.exit(1)
        cloud_status(sys.argv[2])
    elif cmd == "cloud_shadow":
        if len(sys.argv) < 3:
            print("Usage: python3 tuya_client.py cloud_shadow <id>")
            sys.exit(1)
        cloud_shadow(sys.argv[2])
    elif cmd == "cloud_control":
        if len(sys.argv) < 5:
            print("Usage: python3 tuya_client.py cloud_control <id> <dps> <value>")
            sys.exit(1)
        cloud_control(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
