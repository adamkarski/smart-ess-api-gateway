import { automationState } from '../state';
import { fetchWeather } from '../nodes/weather.node';
import { state as inverterState } from '../../state';
import { getTuyaDeviceStatus, setTuyaDeviceStatus } from '../nodes/tuya.node';

export async function runAutomationEngine() {
    console.log('Running automation engine cycle...');

    // 1. Update Data Nodes
    await updateWeatherNode();
    await updateInverterNode();
    await updateTuyaNodes();

    // 2. Evaluate Rules
    evaluateRules();
}

async function updateWeatherNode() {
    const node = automationState.nodes['weather-1'];
    const settings = automationState.settings.weather;

    try {
        const weatherData = await fetchWeather(settings.apiKey, settings.lat, settings.lon);
        node.data = weatherData;
        node.lastUpdate = Date.now();
        console.log('Weather node updated:', weatherData.description);
    } catch (error) {
        console.error('Failed to update weather node:', error.message);
    }
}

async function updateInverterNode() {
    const node = automationState.nodes['inverter-1'];
    if (!node) return;

    // Map existing DESS inverter state to the automation node
    const devices = Array.from(inverterState.authMap.values());
    if (devices.length > 0) {
        node.data = devices[0];
        node.lastUpdate = Date.now();
    }
}

async function updateTuyaNodes() {
    const tuyaNodes = Object.values(automationState.nodes).filter(n => n.type === 'tuya');
    for (const node of tuyaNodes) {
        if (node.config?.id && node.config?.key) {
            const status = await getTuyaDeviceStatus(node.config);
            if (status !== null) {
                node.data = status;
                node.lastUpdate = Date.now();
            }
        }
    }
}

function evaluateRules() {
    for (const rule of automationState.rules) {
        if (!rule.enabled) continue;

        const allConditionsMet = rule.conditions.every(condition => {
            const node = automationState.nodes[condition.nodeId];
            if (!node) return false;

            const value = getNestedValue(node.data, condition.parameter);
            
            switch (condition.operator) {
                case 'eq': return value === condition.value;
                case 'gt': return Number(value) > Number(condition.value);
                case 'lt': return Number(value) < Number(condition.value);
                case 'true': return value === true || value === 'true';
                case 'false': return value === false || value === 'false';
                default: return false;
            }
        });

        if (allConditionsMet) {
            console.log(`Executing rule: ${rule.name}`);
            executeActions(rule.actions);
        }
    }
}

function getNestedValue(obj: any, path: string) {
    if (!obj) return undefined;
    return path.split('.').reduce((prev, curr) => prev?.[curr], obj);
}

async function executeActions(actions: any[]) {
    for (const action of actions) {
        console.log(`Executing action on node ${action.nodeId}: ${action.action}`);
        const node = automationState.nodes[action.nodeId];
        if (!node) continue;

        if (node.type === 'tuya' && action.action === 'set') {
            await setTuyaDeviceStatus(node.config, action.params.dps, action.params.value);
        }
        // TODO: Add Inverter actions
    }
}
