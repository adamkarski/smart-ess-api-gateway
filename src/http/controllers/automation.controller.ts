import { automationState } from '../../automation/state';
import { loadAutomationState } from '../../automation/persistence';
import { saveAutomationState } from '../../automation/persistence';
import { discoverTuyaDevices, tuyaManager } from '../../automation/nodes/tuya.node';
import { evaluateFlow } from '../../automation/engine/automation-engine';
import { getTariffForSelect } from '../../automation/tariff-parser';
import { getCurrentPricePerKwh } from '../../automation/dynamic-prices';
import { EnergyManager } from '../../automation/energy-manager';
import { getTodayStats } from '../../stats/daily-stats';

export async function automationController(server: any) {
    // GET /automation/state
    server.get('/automation/state', async (request, reply) => {
        reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        reply.header('Pragma', 'no-cache');
        reply.header('Expires', '0');
        return automationState;
    });

    // POST /automation/reload – reload automation state from disk
    server.post('/automation/reload', async () => {
        loadAutomationState();
        return automationState;
    });

    // GET /automation/tariff-presets - zwraca listę predefiniowanych taryf z CSV
    server.get('/automation/tariff-presets', async () => {
        try {
            const presets = getTariffForSelect();
            return { presets };
        } catch (e) {
            console.error('[Automation] Error loading tariff presets:', e);
            return { presets: [], error: 'Failed to load tariff presets' };
        }
    });

    // GET /automation/tariff-prices - zwraca aktualne ceny dynamiczne
    server.get('/automation/tariff-prices', async () => {
        const tariff = (automationState.settings as any).tariff;
        return {
            source: tariff?.source || 'static',
            currentPricePerKwh: getCurrentPricePerKwh(),
            dynamicPrices: tariff?.dynamicPrices || [],
            threshold: tariff?.dynamicThreshold || 300,
            lastFetch: tariff?.lastPriceFetch || null,
        };
    });

    // GET /automation/charging-estimate - zwraca szacunki ładowania
    server.get('/automation/charging-estimate', async () => {
        return EnergyManager.calculateEstimate();
    });

    // GET /automation/battery-runtime - zwraca info o czasie pracy na baterii
    server.get('/automation/battery-runtime', async () => {
        try {
            const est = EnergyManager.calculateEstimate();
            return {
                currentSoc: Math.round(est.currentSoc),
                currentKwh: est.currentKwh,
                batteryKwh: est.batteryKwh,
                avgConsumptionW: Math.round(est.avgConsumptionKw * 1000),
                avgRuntimeHours: est.hoursLeft,
                avgRuntimeText: formatRuntime(est.hoursLeft),
                deficitKwh: est.deficitKwh,
                targetSoc: est.targetSoc
            };
        } catch (e) {
            return { error: (e as Error).message };
        }
    });

    // GET /automation/dashboard-data - zwraca wszystkie dane dla widgetów
    server.get('/automation/dashboard-data', async () => {
        return getDashboardData();
    });

    // POST /automation/tuya/discover
    server.post('/automation/tuya/discover', async (request: any, reply: any) => {
        try {
            const devices = await discoverTuyaDevices();
            return { devices };
        } catch (error) {
            console.error('Tuya discovery error:', error);
            reply.status(500).send({ error: 'Failed to discover devices', details: error.message });
        }
    });

    // POST /automation/nodes
    server.post('/automation/nodes', async (request: any, reply: any) => {
        try {
            const { node } = request.body;
            if (node && node.id) {
                if (automationState.nodes[node.id]) {
                    // Update only allowed fields
                    const { data, lastVal, lastUpdate, ...safeNode } = node;
                    Object.assign(automationState.nodes[node.id], safeNode);
                } else {
                    automationState.nodes[node.id] = node;
                }
                saveAutomationState();
                return { success: true };
            }
            reply.status(400).send({ error: 'Invalid node data' });
        } catch (error) {
            reply.status(500).send({ error: 'Failed to save node', details: (error as Error).message });
        }
    });

    // DELETE /automation/nodes/:id
    server.delete('/automation/nodes/:id', async (request: any, reply: any) => {
        try {
            const { id } = request.params;
            if (automationState.nodes[id]) {
                delete automationState.nodes[id];
                saveAutomationState();
                return { success: true };
            }
            reply.status(404).send({ error: 'Node not found' });
        } catch (error) {
            reply.status(500).send({ error: 'Failed to delete node', details: (error as Error).message });
        }
    });

    // POST /automation/tuya/import
    server.post('/automation/tuya/import', async (request: any, reply: any) => {
        try {
            const importedDevices = await tuyaManager.syncWithCloud();
            return { success: true, message: `Zsynchronizowano pomyślnie.`, devices: importedDevices };
        } catch (error) {
            console.error('Tuya import error:', error);
            reply.status(500).send({ error: 'Błąd połączenia z API Tuya', details: (error as Error).message });
        }
    });

    server.post('/automation/settings', async (request: any) => {
        const { weather, tuya, solar, dess, tariff } = request.body;
        if (weather) Object.assign(automationState.settings.weather, weather);
        if (tuya) Object.assign(automationState.settings.tuya, tuya);
        if (solar) Object.assign(automationState.settings.solar, solar);
        if (dess) Object.assign(automationState.settings.dess, dess);
        if (tariff) Object.assign(automationState.settings.tariff || {}, tariff);
        saveAutomationState();
        return { success: true };
    });

    server.get('/automation/dashboard-widgets', async () => {
        return { widgets: automationState.settings.dashboard_widgets || [] };
    });

    server.post('/automation/dashboard-widgets', async (request: any) => {
        const { widgets } = request.body;
        if (Array.isArray(widgets)) {
            automationState.settings.dashboard_widgets = widgets;
            saveAutomationState();
            return { success: true };
        }
        return { success: false, error: 'Invalid widgets data' };
    });

    // POST /automation/rules (This handles links and node positions)
    server.post('/automation/rules', async (request: any) => {
        const { links, nodes } = request.body;
        if (links) automationState.links = links;
        if (nodes) {
            for (const id in nodes) {
                if (automationState.nodes[id]) {
                    // Protect runtime data from being overwritten by potentially stale frontend cache
                    const { data, lastVal, lastUpdate, ...safeNode } = nodes[id];
                    Object.assign(automationState.nodes[id], safeNode);
                }
            }
        }
        evaluateFlow();
        saveAutomationState();
        return { success: true };
    });

    server.post('/automation/tuya/control', async (request: any, reply: any) => {
        const { id, dps, value } = request.body;
        const success = await tuyaManager.setStatus(id, dps, value);
        return { success };
    });

    // GET /automation/logs
    server.get('/automation/logs', async (request: any, reply: any) => {
        try {
            const fs = require('fs');
            const path = require('path');
            const logPath = path.join(process.cwd(), 'logs', 'stdout.log');
            if (fs.existsSync(logPath)) {
                const logs = fs.readFileSync(logPath, 'utf-8');
                const lines = logs.split('\n');
                return { logs: lines.slice(-100).join('\n') };
            }
            return { logs: 'Brak pliku logów.' };
        } catch (e) {
            return { logs: 'Błąd odczytu logów: ' + e.message };
        }
    });
}

function formatRuntime(hours: number): string {
    if (hours >= 999) return '∞';
    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const h = Math.round(hours % 24);
        return `${days}d ${h}h`;
    }
    const h = Math.floor(hours);
    const m = Math.round((hours % 1) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function getDashboardData() {
    const solar = automationState.settings.solar;
    const batKw = solar?.batteryKwh || 10;

    let currentSoc = 50;
    let gridW = 0;
    let loadW = 0;
    let pvW = 0;
    let batW = 0;

    try {
        const socNode = automationState.nodes['inv-soc_high'];
        if (socNode?.lastVal) {
            currentSoc = Math.min(100, Math.max(0, parseFloat(socNode.lastVal)));
        }

        const pvNode = automationState.nodes['inv-pv_power'];
        if (pvNode?.data) {
            gridW = (pvNode.data.grid_active_power || 0) * 1000;
            loadW = (pvNode.data.active_power || 0) * 1000;
            pvW = (pvNode.data.pv_power || 0) * 1000;
            batW = (pvNode.data.bat_power || 0) * 1000;
        }
    } catch (e) { }

    return {
        battery: {
            soc: Math.round(currentSoc),
            kwh: Math.round(currentSoc * batKw / 100 * 100) / 100,
            totalKwh: batKw,
            charging: batW > 0,
            powerW: Math.round(Math.abs(batW)),
        },
        pv: {
            powerW: Math.round(pvW),
            kwh: 0,
        },
        grid: {
            powerW: Math.round(gridW),
            importing: gridW > 0,
        },
        load: {
            powerW: Math.round(loadW),
        },
    };
}
