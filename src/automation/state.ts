import { AutomationState } from './types';

// Default initial state
export const automationState: AutomationState = {
    nodes: {
        'weather-1': {
            id: 'weather-1',
            type: 'weather',
            name: 'Pogoda Lokalna',
            config: {},
            lastUpdate: 0,
            data: {}
        },
        'inverter-1': {
            id: 'inverter-1',
            type: 'inverter',
            name: 'Falownik DESS',
            config: {},
            lastUpdate: 0,
            data: {}
        }
    },
    rules: [],
    settings: {
        weather: {
            apiKey: '5d652f0bff80d46c6a9ce422c48e4296',
            lat: '49.88087',
            lon: '19.56303'
        },
        tuya: {
            apiKey: '',
            apiSecret: '',
            region: 'eu'
        }
    }
};
