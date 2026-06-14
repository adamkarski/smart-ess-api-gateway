import { automationState } from './state';
import * as fs from 'fs';
import * as path from 'path';

// Resolve the automation file. Use the main file by default.
// Fall back to the most recent backup only if the main file is missing.
const DATA_DIR = path.resolve(__dirname, '../../data');
let STORAGE_PATH = path.join(DATA_DIR, 'automation.json');
if (!fs.existsSync(STORAGE_PATH)) {
  try {
    const files = fs.readdirSync(DATA_DIR);
    const backups = files
      .filter(f => f.startsWith('automation.json.backup'))
      .map(f => ({ name: f, stat: fs.statSync(path.join(DATA_DIR, f)) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    if (backups.length) {
      STORAGE_PATH = path.join(DATA_DIR, backups[0].name);
      console.log('[Automation] Main file missing, using backup:', STORAGE_PATH);
    }
  } catch (e) {
    console.warn('[Automation] Failed to resolve backup automation file:', e);
  }
}


export function saveAutomationState() {
    try {
        const dir = path.dirname(STORAGE_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(STORAGE_PATH, JSON.stringify(automationState, null, 2));
    } catch (error) {
        console.error('Failed to save automation state:', error);
    }
}

export function loadAutomationState() {
    try {
        if (fs.existsSync(STORAGE_PATH)) {
            const data = fs.readFileSync(STORAGE_PATH, 'utf-8');
            const loaded = JSON.parse(data);
            
            // Merge loaded state into the live state (deep merge for nested objects)
            if (loaded.settings?.weather) Object.assign(automationState.settings.weather, loaded.settings.weather);
            if (loaded.settings?.tuya) Object.assign(automationState.settings.tuya, loaded.settings.tuya);
            if (loaded.settings?.solar) Object.assign(automationState.settings.solar, loaded.settings.solar);
            if (loaded.settings?.dashboard_widgets) automationState.settings.dashboard_widgets = loaded.settings.dashboard_widgets;
            if (loaded.settings?.tariff) Object.assign(automationState.settings.tariff, loaded.settings.tariff);
            automationState.links = loaded.links || [];
            automationState.nodes = loaded.nodes || automationState.nodes;
            automationState.tuya_devices = loaded.tuya_devices || {};
            
            // Reset transient tracking state on all nodes after restart
            for (const node of Object.values(automationState.nodes)) {
                if (node.data?._lastSentTarget !== undefined) {
                    node.data._lastSentTarget = undefined;
                }
                if (node.data?._lastToggleResult !== undefined) {
                    node.data._lastToggleResult = undefined;
                }
            }
            
            console.log('Automation state loaded from disk');
        }
    } catch (error) {
        console.error('Failed to load automation state:', error);
    }
}
