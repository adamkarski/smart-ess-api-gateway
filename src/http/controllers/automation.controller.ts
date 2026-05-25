import { automationState } from '../../automation/state';
import { saveAutomationState } from '../../automation/persistence';

export async function automationController(server: any) {
    // GET /automation/state
    server.get('/automation/state', async () => {
        return automationState;
    });

    // POST /automation/settings
    server.post('/automation/settings', async (request: any) => {
        const { weather, tuya } = request.body;
        if (weather) Object.assign(automationState.settings.weather, weather);
        if (tuya) Object.assign(automationState.settings.tuya, tuya);
        saveAutomationState();
        return { success: true };
    });

    // POST /automation/rules
    server.post('/automation/rules', async (request: any) => {
        automationState.rules = request.body.rules;
        saveAutomationState();
        return { success: true };
    });
}
