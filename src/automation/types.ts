export type NodeType = 'weather' | 'inverter' | 'tuya' | 'logic' | 'action' | 'else' | 'timer' | 'merge' | 'execute' | 'bms' | 'predictor' | 'calc';

export type WidgetSourceType = 'preset-battery' | 'preset-load' | 'preset-pv' | 'preset-grid' | 'preset-battery-runtime' | 'preset-charge-plan' | 'tuya' | 'inverter' | 'weather' | 'predictor';

export interface TariffRange {
    start: string; // HH:MM
    end: string;   // HH:MM
    type: 'peak' | 'offpeak';
}

export interface DynamicPrice {
    date: string;         // YYYY-MM-DD
    hour: number;         // 0-23
    pricePerMwh: number;  // PLN per MWh
    isCheap: boolean;     // below threshold
}

export interface TariffSettings {
    provider: string;     // e.g. "G12w"
    source: 'static' | 'dynamic';  // static preset or dynamic API
    peakRanges: TariffRange[];
    offpeakRanges: TariffRange[];
    peakPricePerKwh: number;
    offpeakPricePerKwh: number;
    // Dynamic price settings
    dynamicApiUrl?: string;
    dynamicThreshold?: number;  // PLN/MWh - prices below this are "cheap"
    dynamicPrices?: DynamicPrice[];
    lastPriceFetch?: number;   // timestamp
}

export interface DashboardWidget {
    id: string;
    title: string;
    sourceType: WidgetSourceType;
    deviceId?: string;
    dpsKey?: string;
    dpsDivisor?: number;
    inverterParam?: string;
    unit?: string;
    color?: string;
    icon?: string;
    subParam?: string;
    subUnit?: string;
    subDivisor?: number;
}

export interface TuyaLocalDevice {
    internal_app_id: string; // Permanent UUID
    tuya_device_id: string;  // Volatile ID from Tuya
    local_key: string;       // Volatile Key from Tuya
    ip?: string;
    name: string;
    status: 'online' | 'offline';
    version: string;         // Protocol version (e.g. "3.3", "3.4")
    last_sync: number;
    category?: string;       // Tuya device category (e.g. "tdq", "dlq", "pir")
    product_id?: string;     // Product ID for device-specific handling
    last_dps?: Record<string, any>;
    last_dps_translated?: Record<string, any>;
    last_dps_time?: number;
}

export interface AutomationNode {
    id: string; // This will be internal_app_id for devices
    type: NodeType;
    name: string;
    config: any;
    lastUpdate: number;
    data: any;
    x: number;
    y: number;
    lastVal?: string;
}

export interface AutomationLink {
    id: string;
    fromNode: string;
    toNode: string;
}

export interface AutomationState {
    weatherData?: any;
    solarForecast?: any;
    nodes: Record<string, AutomationNode>;
    links: AutomationLink[];
    settings: {
        weather: { apiKey: string; lat: string; lon: string; };
        tuya: { apiKey: string; apiSecret: string; region: string; };
        solar: {
            kwp: number;
            tilt: number;
            azimuth: number;
            elevation: number;
            batteryKwh: number;
            inverterKw: number;
            chargeCurrentA: number;
        };
        dess: {
            pn: string;
            sn: string;
            devcode: string;
            devaddr: string;
            batteryVoltage: number;
            username: string;
        };
        inverter: {
            brand: string;
            model: string;
        };
        bms: {
            brand: string;
            model: string;
            host?: string;
        };
        tariff?: TariffSettings;
        dashboard_widgets?: DashboardWidget[];
    };
    tuya_devices: Record<string, TuyaLocalDevice>; // Permanent storage for Tuya devices
    _tick?: number;
}
