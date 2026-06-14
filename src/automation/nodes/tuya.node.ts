import { automationState } from '../state';
import { saveAutomationState } from '../persistence';
import { TuyaLocalDevice } from '../types';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const PYTHON_BRIDGE = path.join(process.cwd(), 'tuya', 'tuya_client.py');
const IP_MONITOR = path.join(process.cwd(), 'tuya', 'tuya_ip_monitor.py');
const TUYA_DB = path.join(process.cwd(), 'tuya', 'tuya_devices_db.json');

function formatCodeName(code: string): string {
  return code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const DPS_LABELS_CODE: Record<string, Record<string, string>> = {
  dlq: {
    switch: 'Switch', countdown_1: 'Countdown', add_ele: 'Total Energy (kWh)',
    cur_current: 'Current (mA)', cur_power: 'Power (W)', cur_voltage: 'Voltage (V)',
    temp_value: 'Temperature', relay_status: 'Relay', light_mode: 'Light Mode',
    child_lock: 'Child Lock', fault: 'Fault', voltage_coe: 'Voltage Coeff',
    electric_coe: 'Current Coeff', power_coe: 'Power Coeff', electricity_coe: 'Energy Coeff',
  },
  tdq: {
    switch_1: 'Switch', countdown_1: 'Countdown', relay_status: 'Relay',
    light_mode: 'Light Mode', child_lock: 'Child Lock', fault: 'Fault',
    cycle_time: 'Cycle Time', random_time: 'Random Time',
    switch_inching: 'Inching', switch_type: 'Switch Type',
    temperature: 'Temperature',
  },
  pir: {
    pir_state: 'Motion Status', battery_percentage: 'Battery Level (%)',
    motion_interval: 'Detection Interval', illuminance: 'Luminance',
  },
  wsdcg: {
    temp_current: 'Temperature', humidity: 'Humidity', battery_state: 'Battery State',
    battery_percentage: 'Battery Level (%)', temp_alarm: 'Temp Alarm', humidity_alarm: 'Humidity Alarm',
  },
};

const DPS_LABELS_NUM: Record<string, Record<string, string>> = {
  dlq: {
    '1': 'Switch', '9': 'Countdown', '17': 'Total Energy (kWh)',
    '18': 'Current (mA)', '19': 'Power (W)', '20': 'Voltage (V)',
    '21': 'Test Bit', '38': 'Relay', '40': 'Light Mode', '41': 'Child Lock',
    '47': 'Temperature', '26': 'Fault',
  },
  tdq: {
    '1': 'Switch', '9': 'Countdown', '38': 'Relay', '39': 'Light Mode',
    '40': 'Child Lock', '43': 'Inching', '47': 'Switch Type',
  },
  pir: {
    '1': 'Motion Status', '4': 'Battery Level (%)', '9': 'Detection Interval', '101': 'Luminance',
  },
  wsdcg: {
    '1': 'Temperature', '2': 'Humidity', '3': 'Battery State',
    '4': 'Battery Level (%)', '10': 'Temp Alarm', '11': 'Humidity Alarm',
  },
};

// Product-specific overrides for devices mis-categorized by Tuya cloud
const PRODUCT_LABELS_NUM: Record<string, Record<string, string>> = {
  'jc1afi7ow32okd0h': { // 001T03Pro_T1-3S — temperature sensor (shadow: dp_id 101-107)
    '101': 'Temperature', '102': 'Humidity', '103': 'Battery State',
    '104': 'Temp Calibration', '105': 'Hum Calibration',
    '106': 'External Temperature', '107': 'Temp Correction',
  },
  'gk0d4i8g5akryd9d': { // 001P02CB3S — PIR sensor miscategorized as tdq
    '1': 'Motion Status', '4': 'Battery Level (%)', '9': 'Detection Interval', '101': 'Luminance',
  },
};

function translateDps(category: string, mapping: Record<string, any>, dps: Record<string, any>, productId?: string): Record<string, any> {
  const translated: Record<string, any> = {};
  const isNumeric = Object.keys(dps).length > 0 && /^\d+$/.test(Object.keys(dps)[0]);

  // Prefer product-specific override for miscategorized devices
  let map: Record<string, string> = {};
  if (isNumeric) {
    if (productId && PRODUCT_LABELS_NUM[productId]) {
      map = PRODUCT_LABELS_NUM[productId];
    } else {
      map = DPS_LABELS_NUM[category] || {};
    }
    // If mapping from cloud gives us code names, use those
    if (mapping && Object.keys(mapping).length > 0) {
      for (const [key, value] of Object.entries(dps)) {
        const codeName = mapping[key]?.code || '';
        translated[map[key] || formatCodeName(codeName || key)] = value;
      }
      return translated;
    }
  } else {
    map = DPS_LABELS_CODE[category] || {};
  }

  for (const [key, value] of Object.entries(dps)) {
    translated[map[key] || formatCodeName(key)] = value;
  }
  return translated;
}

// Reverse map: numeric DPS index → code-name key (e.g. "1" → "switch" for dlq)
const DPS_NUM_TO_CODE: Record<string, Record<string, string>> = {};
for (const [cat, codeMap] of Object.entries(DPS_LABELS_CODE)) {
  DPS_NUM_TO_CODE[cat] = {};
  for (const [code, label] of Object.entries(codeMap)) {
    const numMap = DPS_LABELS_NUM[cat];
    if (!numMap) continue;
    for (const [num, numLabel] of Object.entries(numMap)) {
      if (numLabel === label) {
        DPS_NUM_TO_CODE[cat][num] = code;
        break;
      }
    }
  }
}

/**
 * Read a DPS value by numeric index, handling both key formats.
 * Tuya cloud may store dps by code-name ("switch") while the engine
 * always looks up by numeric index ("1").  This function tries both.
 */
export function getDpsValue(dps: Record<string, any> | undefined, dpsIndex: number, category?: string): any {
  if (!dps) return undefined;
  // Try numeric key first (e.g. dps["1"])
  const numKey = String(dpsIndex);
  if (dps[numKey] !== undefined) return dps[numKey];
  // Try code-name key via reverse map (e.g. dps["switch"])
  if (category && DPS_NUM_TO_CODE[category]?.[numKey]) {
    const codeKey = DPS_NUM_TO_CODE[category][numKey];
    if (dps[codeKey] !== undefined) return dps[codeKey];
  }
  // Product-specific override keys
  if (category) {
    for (const [pid, pmap] of Object.entries(PRODUCT_LABELS_NUM)) {
      if (pmap[numKey]) {
        // Find the code-name for this product-specific label
        // (product-specific DPS come as raw numeric keys from local/cloud status,
        //  but cloud sync may store them differently — just return undefined)
      }
    }
  }
  return undefined;
}

class TuyaLocalManager {
    private isSyncing = false;
    private ipMonitorProcess: any = null;

    async init() {
        console.log('[Tuya] Initializing offline-first subsystem...');

        if (!automationState.settings.tuya.apiKey && process.env.TUYA_API_KEY) {
            automationState.settings.tuya.apiKey = process.env.TUYA_API_KEY;
        }
        if (!automationState.settings.tuya.apiSecret && process.env.TUYA_API_SECRET) {
            automationState.settings.tuya.apiSecret = process.env.TUYA_API_SECRET;
        }
        if (!automationState.settings.tuya.region && process.env.TUYA_REGION) {
            automationState.settings.tuya.region = process.env.TUYA_REGION;
        }

        const devices = Object.values(automationState.tuya_devices || {});
        console.log(`[Tuya] Loaded ${devices.length} devices from local storage.`);

        this.startIpMonitor();

        if (devices.length === 0) {
            console.log('[Tuya] No cached devices — awaiting initial cloud sync...');
            try {
                await this.quietSync();
            } catch (e) {
                console.error('[Tuya] Initial sync failed:', e.message);
            }
        } else {
            this.quietSync();
        }

        setInterval(() => this.quietSync(), 1000 * 60 * 15);

        setInterval(() => this.pollAllDevices(), 1000 * 60 * 5);

        setTimeout(() => this.pollAllDevices(), 5000);
    }

    private startIpMonitor() {
        try {
            this.ipMonitorProcess = spawn('python3', [IP_MONITOR], {
                cwd: path.join(process.cwd(), 'tuya'),
                stdio: 'ignore',
                detached: true,
            });
            this.ipMonitorProcess.unref();
            console.log('[Tuya] IP monitor started in background.');
        } catch (e) {
            console.error('[Tuya] Failed to start IP monitor:', e.message);
        }
    }

    private async pollAllDevices() {
        const devices = Object.values(automationState.tuya_devices || {});
        for (const dev of devices) {
            try {
                if (dev.ip && dev.ip !== 'null') {
                    await this.getLocalStatus(dev.internal_app_id);
                } else {
                    await this.getCloudStatus(dev.internal_app_id);
                }
            } catch {
            }
        }
    }

    private async quietSync() {
        if (this.isSyncing) return;
        this.isSyncing = true;
        try {
            await this.syncWithCloud();
        } catch (e) {
            console.error('[Tuya] Quiet sync failed:', e.message);
        } finally {
            this.isSyncing = false;
        }
    }

    async syncWithCloud() {
        return new Promise((resolve, reject) => {
            const env = { ...process.env };
            env.TUYA_API_KEY = env.TUYA_API_KEY || automationState.settings.tuya.apiKey || '';
            env.TUYA_API_SECRET = env.TUYA_API_SECRET || automationState.settings.tuya.apiSecret || '';
            env.TUYA_REGION = env.TUYA_REGION || automationState.settings.tuya.region || 'eu';

            execFile('python3', [PYTHON_BRIDGE, 'sync'], {
                cwd: path.join(process.cwd(), 'tuya'),
                env,
                maxBuffer: 1024 * 1024,
            }, (error, stdout, stderr) => {
                const stderrStr = stderr?.toString().trim();
                if (stderrStr) console.error('[Tuya] Sync stderr:', stderrStr);
                if (error) return reject(error);
                try {
                    if (fs.existsSync(TUYA_DB)) {
                        const dbData = JSON.parse(fs.readFileSync(TUYA_DB, 'utf-8'));
                        const cloudDevices = dbData.devices || [];
                        const result = this.mergeCloudDevices(cloudDevices);
                        resolve(result);
                    } else {
                        reject(new Error('DB file not found after sync.'));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    private mergeCloudDevices(cloudDevices: any[]) {
        if (!automationState.tuya_devices) automationState.tuya_devices = {};

        let updated = 0;
        let created = 0;
        const imported: any[] = [];

        for (const cd of cloudDevices) {
            let localDev = Object.values(automationState.tuya_devices).find(d => d.tuya_device_id === cd.id);
            if (!localDev) {
                localDev = Object.values(automationState.tuya_devices).find(d => d.name === cd.name);
            }

            let internalId: string;
            if (localDev) {
                localDev.tuya_device_id = cd.id;
                localDev.local_key = cd.local_key || localDev.local_key;
                localDev.ip = cd.ip;
                localDev.status = cd.online ? 'online' : 'offline';
                localDev.version = cd.version || localDev.version;
                localDev.last_sync = Date.now();
                localDev.category = cd.category || localDev.category;
                localDev.product_id = cd.product_id || localDev.product_id;
                internalId = localDev.internal_app_id;
                updated++;
            } else {
                internalId = `tuya-${cd.id.substring(0, 8)}-${Date.now().toString(36)}`;
                const newDev: TuyaLocalDevice = {
                    internal_app_id: internalId,
                    tuya_device_id: cd.id,
                    local_key: cd.local_key,
                    ip: cd.ip,
                    name: cd.name,
                    status: cd.online ? 'online' : 'offline',
                    version: cd.version || '3.3',
                    last_sync: Date.now(),
                    category: cd.category,
                    product_id: cd.product_id,
                };
                automationState.tuya_devices[internalId] = newDev;
                created++;
            }

            // Update existing device node data if node already exists in the flow
            const productId = cd.product_id || '';
            // Find a tuya node that references this device by config.device_id
            const node = Object.values(automationState.nodes).find(
                n => n.config?.device_id === internalId || n.config?.device_id === cd.id
            );
            if (node) {
                const dpsRaw: Record<string, any> = {};
                if (Array.isArray(cd.status)) {
                    for (const s of cd.status) {
                        dpsRaw[s.code || s.dps_index || s.id] = s.value;
                    }
                }
                const mapping = cd.mapping || {};
                const category = cd.category || node.data?.category || '';
                const translated = translateDps(category, mapping, dpsRaw, productId);

                node.data = {
                    ...node.data,
                    online: cd.online,
                    dps: dpsRaw,
                    dps_translated: translated,
                    mapping,
                    category,
                    product_id: productId,
                    ip: cd.ip,
                    lastSync: Date.now(),
                };
                node.lastUpdate = Date.now();
            }

            imported.push({ id: cd.id, name: cd.name, category: cd.category });
        }

        saveAutomationState();
        return { updated, created, devices: imported };
    }

    private async controlLocal(tuyaDeviceId: string, ip: string, localKey: string, dpsIndex: number, value: any, version: string = '3.3'): Promise<boolean> {
        return new Promise((resolve) => {
            const valStr = value === true ? 'true' : value === false ? 'false' : String(value);
            const args = [
                PYTHON_BRIDGE, 'control',
                tuyaDeviceId, ip, localKey,
                String(dpsIndex), valStr,
            ];
            if (version) args.push(version);
            const proc = execFile('python3', args, { cwd: path.join(process.cwd(), 'tuya'), timeout: 15000 }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`[Tuya] Local control exec error for ${tuyaDeviceId}:`, error.message);
                    return resolve(false);
                }
                const errStr = stderr?.toString().trim();
                if (errStr) console.warn(`[Tuya] Local control stderr: ${errStr}`);
                try {
                    const result = JSON.parse(stdout);
                    if (!result.success) console.error(`[Tuya] Local control returned error:`, result.error);
                    return resolve(result.success === true);
                } catch {
                    console.error(`[Tuya] Local control bad JSON: ${stdout}`);
                    return resolve(false);
                }
            });
            setTimeout(() => { try { proc.kill(); } catch {} resolve(false); }, 15000);
        });
    }

    private async controlCloud(tuyaDeviceId: string, dpsIndex: number, value: any): Promise<boolean> {
        return new Promise((resolve) => {
            const valStr = value === true ? 'true' : value === false ? 'false' : String(value);
            const proc = execFile('python3', [
                PYTHON_BRIDGE, 'cloud_control',
                tuyaDeviceId, String(dpsIndex), valStr,
            ], { cwd: path.join(process.cwd(), 'tuya'), timeout: 15000 }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`[Tuya] Cloud control exec error for ${tuyaDeviceId}:`, error.message);
                    return resolve(false);
                }
                const errStr = stderr?.toString().trim();
                if (errStr) console.warn(`[Tuya] Cloud control stderr: ${errStr}`);
                try {
                    const result = JSON.parse(stdout);
                    return resolve(result.success === true);
                } catch {
                    console.error(`[Tuya] Cloud control bad JSON: ${stdout}`);
                    return resolve(false);
                }
            });
            setTimeout(() => { try { proc.kill(); } catch {} resolve(false); }, 15000);
        });
    }

    async setStatus(internalId: string, dpsIndex: number, value: any) {
        const node = automationState.nodes[internalId];
        let effectiveId = node?.config?.device_id || internalId;
        let config = automationState.tuya_devices[effectiveId];
        if (!config) {
            const found = Object.values(automationState.tuya_devices || {}).find(
                d => d.tuya_device_id === effectiveId
            );
            if (found) { effectiveId = found.internal_app_id; config = found; }
        }
        if (!config) {
            console.warn(`[Tuya] Cannot control ${effectiveId} - device not found.`);
            return false;
        }

        const hasLocalIp = config.ip && config.ip !== 'null';

        if (hasLocalIp) {
            console.log(`[Tuya] Local control: ${config.name} DPS ${dpsIndex} -> ${value} (v${config.version || '3.3'})`);
            const ok = await this.controlLocal(config.tuya_device_id, config.ip, config.local_key, dpsIndex, value, config.version);
            if (ok) {
                // Fire-and-forget: trust UDP delivery, no DPS verification
                // DPS may take minutes to update via polling
                return true;
            }
            console.warn(`[Tuya] Local control failed for ${config.name}`);
        } else {
            console.log(`[Tuya] No local IP for ${config.name}, using cloud control...`);
        }

        // Cloud fallback rate-limited to once per 5 min
        const lastCloud = node?.data?._lastCloudAttempt || 0;
        const now = Date.now();
        if (now - lastCloud < 300_000) {
            const remaining = Math.round((300_000 - (now - lastCloud)) / 1000);
            console.log(`[Tuya] Cloud fallback skipped (rate-limited, ${remaining}s remaining)`);
            return false;
        }

        console.log(`[Tuya] Cloud control: ${config.name} DPS ${dpsIndex} -> ${value}`);
        if (node?.data) node.data._lastCloudAttempt = now;
        const cloudOk = await this.controlCloud(config.tuya_device_id, dpsIndex, value);
        if (!cloudOk) {
            console.error(`[Tuya] Cloud control failed for ${config.name}. If error is 1106 (permission deny), enable "Device Control" service in Tuya IoT Platform (iot.tuya.com → Project → Services → Device Control).`);
        }
        return cloudOk;
    }

    async getLocalStatus(internalId: string) {
        const node = automationState.nodes[internalId];
        const effectiveId = node?.config?.device_id || internalId;
        const config = automationState.tuya_devices[effectiveId];
        if (!config || !config.ip) return null;

        return new Promise((resolve) => {
            const args = [
                PYTHON_BRIDGE, 'status',
                config.tuya_device_id,
                config.ip,
                config.local_key,
            ];
            if (config.version) args.push(config.version);
            const proc = execFile('python3', args, { cwd: path.join(process.cwd(), 'tuya') }, (error, stdout) => {
                if (error) return resolve(null);
                try {
                    const data = JSON.parse(stdout);
                    if (!data.dps) { resolve(data); return; }

                    const category = data.category || '';
                    let mapping: any = {};
                    if (data.mapping) mapping = data.mapping;

                    // Update target node (at effectiveId) if it exists
                    const targetNode = automationState.nodes[effectiveId];
                    const productId = targetNode?.data?.product_id || '';
                    const translated = translateDps(category, mapping, data.dps, productId);
                    if (targetNode) {
                        targetNode.data = {
                            ...targetNode.data,
                            dps: data.dps,
                            dps_translated: translated,
                            online: data.online ?? targetNode.data?.online,
                        };
                        targetNode.lastUpdate = Date.now();
                    }

                    // Always update the original node that triggered the status check
                    const origNode = automationState.nodes[internalId];
                    if (origNode && effectiveId !== internalId) {
                        origNode.data = {
                            ...origNode.data,
                            dps: data.dps,
                            dps_translated: translated,
                            online: data.online ?? origNode.data?.online,
                        };
                        origNode.lastUpdate = Date.now();
                    } else if (!targetNode) {
                        // Only one node exists and it's the original
                        if (origNode) {
                            origNode.data = {
                                ...origNode.data,
                                dps: data.dps,
                                dps_translated: translated,
                                online: data.online ?? origNode.data?.online,
                            };
                            origNode.lastUpdate = Date.now();
                        }
                    }

                    // Save to tuya_devices as fallback for widgets without nodes
                    const devRecord = automationState.tuya_devices[effectiveId];
                    if (devRecord) {
                        devRecord.last_dps = data.dps;
                        devRecord.last_dps_translated = translated;
                        devRecord.last_dps_time = Date.now();
                    }

                    saveAutomationState();
                    resolve(data);
                } catch { resolve(null); }
            });
            // Kill if no response after 10 seconds
            setTimeout(() => {
                try { proc.kill(); } catch {}
                resolve(null);
            }, 10000);
        });
    }

    async getCloudStatus(internalId: string) {
        const node = automationState.nodes[internalId];
        const effectiveId = node?.config?.device_id || internalId;
        const config = automationState.tuya_devices[effectiveId];
        if (!config) return null;

        return new Promise((resolve) => {
            const proc = execFile('python3', [
                PYTHON_BRIDGE, 'cloud_shadow',
                config.tuya_device_id,
            ], { cwd: path.join(process.cwd(), 'tuya'), timeout: 15000 }, (error, stdout) => {
                if (error) return resolve(null);
                try {
                    const result = JSON.parse(stdout);
                    if (!result.success || !result.result?.properties) {
                        resolve(null);
                        return;
                    }

                    const properties: any[] = result.result.properties;
                    const dpsRaw: Record<string, any> = {};
                    for (const prop of properties) {
                        const dpId = String(prop.dp_id);
                        // convert value: for type 'value' values like 205 -> 20.5
                        if (prop.type === 'value') {
                            dpsRaw[dpId] = prop.value;
                        } else {
                            dpsRaw[dpId] = prop.value;
                        }
                    }

                    const productId = config.product_id || '';
                    const category = config.category || '';
                    const translated = translateDps(category, {}, dpsRaw, productId);

                    // Update target node at effectiveId
                    const targetNode = automationState.nodes[effectiveId];
                    if (targetNode) {
                        targetNode.data = {
                            ...targetNode.data,
                            dps: dpsRaw,
                            dps_translated: translated,
                            online: true,
                            product_id: productId,
                        };
                        targetNode.lastUpdate = Date.now();
                    }

                    // Also update original node if different
                    const origNode = automationState.nodes[internalId];
                    if (origNode && effectiveId !== internalId) {
                        origNode.data = {
                            ...origNode.data,
                            dps: dpsRaw,
                            dps_translated: translated,
                            online: true,
                            product_id: productId,
                        };
                        origNode.lastUpdate = Date.now();
                    } else if (!targetNode && origNode) {
                        origNode.data = {
                            ...origNode.data,
                            dps: dpsRaw,
                            dps_translated: translated,
                            online: true,
                            product_id: productId,
                        };
                        origNode.lastUpdate = Date.now();
                    }

                    // Save to tuya_devices as fallback for widgets without nodes
                    const devRecord2 = automationState.tuya_devices[effectiveId];
                    if (devRecord2) {
                        devRecord2.last_dps = dpsRaw;
                        devRecord2.last_dps_translated = translated;
                        devRecord2.last_dps_time = Date.now();
                    }

                    saveAutomationState();
                    resolve(dpsRaw);
                } catch {
                    resolve(null);
                }
            });
            setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 15000);
        });
    }

    getDevices(): TuyaLocalDevice[] {
        return Object.values(automationState.tuya_devices || {});
    }
}

export const tuyaManager = new TuyaLocalManager();

export async function discoverTuyaDevices() {
    return tuyaManager.syncWithCloud();
}
