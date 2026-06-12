const express = require('express');
const { exec, execFile } = require('child_process');
const fs = require('fs');
const cron = require('node-cron');
const path = require('path');

const app = express();
const PORT = 3000;
const DB_FILE = 'tuya_devices_db.json';

app.use(express.json());

// DPS Translation Mappings
const DPS_MAPS = {
    'dlq': { // Smart Breaker / Meter
        '1': 'Switch',
        '9': 'Current (mA)',
        '17': 'Total Energy (kWh)',
        '18': 'Power (W)',
        '19': 'Voltage (V)',
        '101': 'Current (mA) 2',
        '102': 'Power (W) 2',
        '103': 'Voltage (V) 2'
    },
    'tdq': { // Temperature / Humidity Sensor
        '1': 'Temperature',
        '2': 'Humidity',
        '3': 'Battery State',
        '4': 'Battery Level (%)',
        '10': 'Temperature Alarm',
        '11': 'Humidity Alarm'
    },
    'pir': { // Motion Sensor
        '1': 'Motion Status',
        '4': 'Battery Level (%)',
        '9': 'Detection Interval',
        '101': 'Luminance'
    }
};

function translateDPS(device, dps) {
    const category = device.category;
    const cloudMapping = device.mapping || {};
    const map = DPS_MAPS[category] || {};
    const translated = {};
    
    for (const [key, value] of Object.entries(dps)) {
        // Priority: 1. Cloud Mapping Name, 2. Local Manual Map, 3. Raw DPS key
        let label = (cloudMapping[key] && cloudMapping[key].code) || map[key] || `DPS ${key}`;
        let val = value;
        
        // Better formatting based on cloud metadata or manual rules
        const metadata = cloudMapping[key] || {};
        const scale = metadata.values && metadata.values.scale;
        const unit = (metadata.values && metadata.values.unit) || '';

        if (typeof val === 'number') {
            if (scale) val = (val / Math.pow(10, scale)).toFixed(scale);
            else if (label.includes('temp') || label.includes('Temperature')) val = (val / 10).toFixed(1);
            else if (label.includes('volt') || label.includes('Voltage')) val = (val / 10).toFixed(1);
            
            if (unit) val += ` \${unit}`;
        }
        
        if (label === 'Motion Status' || label === 'pir_state') val = value === 'pir' || value === true ? '🚨 MOTION' : 'Clear';

        translated[label] = val;
    }
    return translated;
}

// Load database
function loadDB() {
    if (fs.existsSync(DB_FILE)) {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
        // If it's a flat array (from wizard), wrap it in the expected object format
        if (Array.isArray(data)) {
            return { lastSync: 'Imported from Wizard', devices: data };
        }
        return data;
    }
    return { lastSync: null, devices: [] };
}

// Sync devices via Python bridge
function syncDevices() {
    console.log('🔄 Syncing devices via TinyTuya...');
    return new Promise((resolve, reject) => {
        execFile('python3', ['tuya_client.py', 'sync'], (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Sync error: ${error.message}`);
                return reject(error);
            }
            console.log(`✅ Sync output: ${stdout}`);
            resolve(stdout);
        });
    });
}

// Control device via Python bridge
function controlDevice(deviceId, ip, key, dps, value, version) {
    console.log(`📡 Controlling device ${deviceId} (DPS ${dps}) -> ${value} (v${version || '3.3'})`);
    if (!ip || ip === 'null' || ip === 'Unknown') {
        return Promise.reject(new Error('Missing IP for local control'));
    }

    const args = ['tuya_client.py', 'control', deviceId, ip, key, dps.toString(), value.toString()];
    if (version) args.push(version.toString());

    return new Promise((resolve, reject) => {
        execFile('python3', args, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Control error: ${error.message}`);
                return reject(error);
            }
            console.log(`✅ Control output: ${stdout}`);
            resolve(stdout);
        });
    });
}

// Get device status (Local with Cloud fallback)
function getStatus(deviceId, ip, key, version) {
    const isLocalAvailable = ip && ip !== 'null' && ip !== 'Unknown' && ip !== '';
    
    if (isLocalAvailable) {
        console.log(`📡 Attempting local status for ${deviceId} at ${ip}...`);
        const args = ['tuya_client.py', 'status', deviceId, ip, key];
        if (version) args.push(version.toString());

        return new Promise((resolve, reject) => {
            execFile('python3', args, (error, stdout, stderr) => {
                let result = null;
                try {
                    const jsonMatch = stdout.match(/\{.*\}/s);
                    if (jsonMatch) result = JSON.parse(jsonMatch[0]);
                } catch (e) {}

                // If local failed OR returned an error code (like 914), fallback to cloud
                if (error || !result || result.error) {
                    console.log(`⚠️ Local status failed for ${deviceId} (Code: \${result ? result.code : 'unknown'}), falling back to cloud...`);
                    return getCloudStatus(deviceId).then(resolve).catch(reject);
                }
                resolve(result);
            });
        });
    } else {
        console.log(`☁️ No local IP for ${deviceId}, using cloud status...`);
        return getCloudStatus(deviceId);
    }
}

// Automatic Polling: Refresh all devices every 3 minutes
async function pollAllDevices() {
    console.log('⏱️ Starting automatic background poll...');
    const db = loadDB();
    const updatedDevices = [];

    for (const dev of db.devices) {
        try {
            console.log(`Polling \${dev.name}...`);
            const data = await getStatus(dev.id, dev.ip, dev.local_key || dev.key, dev.version);
            if (data && data.dps) {
                // Update device status in memory/DB
                const newStatus = Object.entries(data.dps).map(([code, value]) => ({ code, value }));
                dev.status = newStatus;
                if (data.source === 'local' && data.version) dev.version = data.version;
                console.log(`✅ \${dev.name} updated.`);
            }
        } catch (err) {
            console.error(`❌ Failed to poll \${dev.name}: \${err.message}`);
        }
        updatedDevices.push(dev);
    }

    db.devices = updatedDevices;
    db.lastSync = new Date().toLocaleString();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    console.log('🏁 Background poll completed.');
}

function getCloudStatus(deviceId) {
    return new Promise((resolve, reject) => {
        execFile('python3', ['tuya_client.py', 'cloud_status', deviceId], (error, stdout, stderr) => {
            if (error) return reject(error);
            try {
                const jsonMatch = stdout.match(/\{.*\}/s);
                if (jsonMatch) {
                    const data = JSON.parse(jsonMatch[0]);
                    // Standardize cloud response to look like local response for translation
                    if (data.result) {
                        const standardized = { dps: {}, source: 'cloud' };
                        data.result.forEach(item => {
                            // Map codes to typical DPS IDs if possible, or use codes as keys
                            standardized.dps[item.code] = item.value;
                        });
                        resolve(standardized);
                    } else {
                        resolve(data);
                    }
                } else reject(new Error('No JSON in cloud output'));
            } catch (e) { reject(e); }
        });
    });
}

// Routes
app.get('/', (req, res) => {
    const db = loadDB();
    let devicesHtml = db.devices.map(d => {
        const hasSwitchInMapping = d.mapping && Object.values(d.mapping).some(m => m.code && m.code.includes('switch'));
        const hasSwitchInStatus = d.status && d.status.some(s => s.code && s.code.includes('switch'));
        const canControl = hasSwitchInMapping || hasSwitchInStatus;

        // Prepare initial data from DB
        let initialData = 'Click refresh to load latest...';
        if (d.status) {
            const statusObj = {};
            d.status.forEach(s => statusObj[s.code] = s.value);
            const translated = translateDPS(d, statusObj);
            initialData = Object.entries(translated).map(([label, val]) => 
                `<div class="dps-row"><span class="dps-label">${label}:</span><span>${val}</span></div>`
            ).join('');
        }

        return `
        <div class="device-card" id="dev-${d.id}">
            <div class="device-header" onclick="toggleDetails('${d.id}')">
                <div>
                    <strong>${d.name}</strong> (${d.category || 'unknown'})<br>
                    <small>ID: ${d.id} | IP: ${d.ip || 'Unknown'} | v${d.version || '3.3'}</small>
                </div>
                <div class="indicator" id="status-${d.id}">?</div>
            </div>
            <div class="controls">
                ${canControl ? `
                    <button onclick="control('${d.id}', '${d.ip}', '${d.key}', 1, true, '${d.version || '3.3'}')">ON</button>
                    <button onclick="control('${d.id}', '${d.ip}', '${d.key}', 1, false, '${d.version || '3.3'}')">OFF</button>
                ` : ''}
                <button class="secondary" onclick="refreshStatus('${d.id}', '${d.ip}', '${d.key}', '${d.version || '3.3'}')">Refresh Data</button>
            </div>
            <div class="details" id="details-${d.id}" style="display:none">
                <div class="json-data" id="data-${d.id}">${initialData}</div>
            </div>
        </div>
        `;
    }).join('');

    res.send(`
        <html>
        <head>
            <title>Tuya Local Manager</title>
            <style>
                body { font-family: sans-serif; background: #f0f2f5; padding: 20px; }
                .device-card { background: white; padding: 15px; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .device-header { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
                .indicator { width: 15px; height: 15px; border-radius: 50%; background: #ccc; }
                .online { background: #28a745; }
                .offline { background: #dc3545; }
                .controls { margin-top: 15px; border-top: 1px solid #eee; padding-top: 10px; }
                button { padding: 8px 16px; cursor: pointer; background: #007bff; color: white; border: none; border-radius: 4px; margin-right: 5px; }
                button.secondary { background: #6c757d; }
                button:hover { opacity: 0.9; }
                .details { margin-top: 10px; background: #f8f9fa; padding: 10px; border-radius: 4px; }
                .json-data { font-size: 13px; line-height: 1.6; }
                .dps-row { display: flex; justify-content: space-between; border-bottom: 1px solid #eee; padding: 4px 0; }
                .dps-label { font-weight: bold; color: #555; }
                .header { display: flex; justify-content: space-between; align-items: center; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Tuya Local Manager v2.1</h1>
                <button onclick="sync()">Sync Cloud List</button>
            </div>
            <p>Last Sync: ${db.lastSync}</p>
            <div id="devices">${devicesHtml}</div>

            <script>
                function toggleDetails(id) {
                    const el = document.getElementById('details-' + id);
                    el.style.display = el.style.display === 'none' ? 'block' : 'none';
                }

                async function refreshStatus(id, ip, key, version) {
                    const btn = event.target;
                    const oldText = btn.innerText;
                    btn.disabled = true;
                    btn.innerText = 'Loading...';
                    
                    try {
                        const res = await fetch('/status', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id, ip, key, version })
                        });
                        const data = await res.json();
                        
                        const container = document.getElementById('data-' + id);
                        const indicator = document.getElementById('status-' + id);
                        
                        if (data.error) {
                            container.innerHTML = '<span style="color:red">Error: ' + data.error + '</span>';
                            indicator.className = 'indicator offline';
                        } else {
                            indicator.className = 'indicator online';
                            
                            // Render translated DPS
                            let html = '<div style="margin-bottom:10px"><strong>Version:</strong> ' + (data.version || version) + '</div>';
                            if (data.translated) {
                                for (const [label, val] of Object.entries(data.translated)) {
                                    html += \`<div class="dps-row">
                                        <span class="dps-label">\${label}:</span>
                                        <span>\${val}</span>
                                    </div>\`;
                                }
                            } else {
                                html += '<div>No DPS data received. Data: ' + JSON.stringify(data) + '</div>';
                            }
                            container.innerHTML = html;
                        }
                    } catch (err) {
                        alert('Status check failed: ' + err.message);
                    } finally {
                        btn.disabled = false;
                        btn.innerText = oldText;
                    }
                }

                async function control(id, ip, key, dps, val, version) {
                    try {
                        const res = await fetch('/control', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id, ip, key, dps, val, version })
                        });
                        const data = await res.json();
                        if (data.error) alert(data.error);
                        else refreshStatus(id, ip, key, version);
                    } catch (err) {
                        alert('Control failed: ' + err.message);
                    }
                }

                async function sync() {
                    const res = await fetch('/sync', { method: 'POST' });
                    const data = await res.json();
                    alert(data.message);
                    location.reload();
                }
            </script>
        </body>
        </html>
    `);
});

app.post('/sync', async (req, res) => {
    try {
        await syncDevices();
        res.json({ message: 'Sync successful' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/control', async (req, res) => {
    const { id, ip, key, dps, val, version } = req.body;
    try {
        await controlDevice(id, ip, key, dps, val, version);
        res.json({ message: `Successfully sent ${val} to device` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/status', async (req, res) => {
    const { id, ip, key, version } = req.body;
    try {
        const db = loadDB();
        const device = db.devices.find(d => d.id === id) || {};
        
        const data = await getStatus(id, ip, key, version);
        
        if (data && data.dps) {
            data.translated = translateDPS(device, data.dps);
        }
        
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cron job: Sync Cloud List every 6 hours
cron.schedule('0 */6 * * *', () => syncDevices());

// Cron job: Automatic Poll every 5 minutes
cron.schedule('*/5 * * * *', () => pollAllDevices());

app.listen(PORT, async () => {
    console.log(`🚀 Tuya Manager running at http://localhost:${PORT}`);
    
    // Initial sync and poll on start
    const db = loadDB();
    if (db.devices.length === 0) {
        await syncDevices();
    }
    // Always poll on start to get fresh data
    pollAllDevices();
});
