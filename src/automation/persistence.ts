import { automationState } from './state';
import * as fs from 'fs';
import * as path from 'path';

const STORAGE_PATH = path.join(process.cwd(), 'data', 'automation.json');

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
            
            // Merge loaded state into the live state
            Object.assign(automationState.settings, loaded.settings);
            automationState.rules = loaded.rules || [];
            automationState.nodes = loaded.nodes || automationState.nodes;
            
            console.log('Automation state loaded from disk');
        }
    } catch (error) {
        console.error('Failed to load automation state:', error);
    }
}
