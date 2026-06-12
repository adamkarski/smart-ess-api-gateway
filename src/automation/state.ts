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
            data: {},
            x: 100,
            y: 100
        },
        'inverter-1': {
            id: 'inverter-1',
            type: 'inverter',
            name: 'Falownik DESS',
            config: {},
            lastUpdate: 0,
            data: {},
            x: 400,
            y: 100
        },
        'action-console': {
            id: 'action-console',
            type: 'action',
            name: 'Konsola Wyjścia',
            config: {},
            lastUpdate: 0,
            data: {},
            x: 700,
            y: 100
        }
    },
    links: [],
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
        },
        solar: {
            kwp: 4.2,
            tilt: 90,
            azimuth: 222,
            elevation: 340,
            batteryKwh: 10,
            inverterKw: 6.2,
        },
        dess: {
            pn: 'Q0046526419165',
            sn: 'Q0046526419165094801',
            devcode: '2376',
            devaddr: '1',
            batteryVoltage: 48,
            username: 'toshinori',
        },
        inverter: {
            brand: 'ANENJI',
            model: 'anenji-6200',
        },
        bms: {
            brand: 'JKBMS',
            model: '',
            host: '',
        },
        tariff: {
            provider: 'G12w',
            source: 'static',
            peakRanges: [
                { start: '06:00', end: '13:00', type: 'peak' as const },
                { start: '15:00', end: '22:00', type: 'peak' as const },
            ],
            offpeakRanges: [
                { start: '13:00', end: '15:00', type: 'offpeak' as const },
                { start: '22:00', end: '06:00', type: 'offpeak' as const },
            ],
            peakPricePerKwh: 0.85,
            offpeakPricePerKwh: 0.55,
            dynamicThreshold: 300, // PLN/MWh - default threshold
            dynamicPrices: [],
        },
        dashboard_widgets: [],
    },
    weatherData: null,
    solarForecast: null,
    tuya_devices: {}, // Permanent storage for Tuya devices
    _tick: 0,
};
