const TuyAPI = require('tuyapi');

export interface TuyaDeviceConfig {
    id: string;
    key: string;
    ip?: string;
    name: string;
}

const deviceInstances: Record<string, any> = {};

export async function getTuyaDeviceStatus(config: TuyaDeviceConfig) {
    const device = getOrInitDevice(config);
    try {
        await device.find();
        await device.connect();
        const status = await device.get();
        await device.disconnect();
        return status;
    } catch (error) {
        console.error(`Tuya error for ${config.name}:`, error.message);
        return null;
    }
}

export async function setTuyaDeviceStatus(config: TuyaDeviceConfig, dpsIndex: number, value: any) {
    const device = getOrInitDevice(config);
    try {
        await device.find();
        await device.connect();
        await device.set({ dps: dpsIndex, set: value });
        await device.disconnect();
        return true;
    } catch (error) {
        console.error(`Tuya set error for ${config.name}:`, error.message);
        return false;
    }
}

function getOrInitDevice(config: TuyaDeviceConfig) {
    if (!deviceInstances[config.id]) {
        deviceInstances[config.id] = new TuyAPI({
            id: config.id,
            key: config.key,
            ip: config.ip
        });
    }
    return deviceInstances[config.id];
}
