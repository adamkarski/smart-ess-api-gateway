import type { Inverter } from './interfaces/inverter.interface';
import type { BMS } from './interfaces/bms.interface';

const inverters = new Map<string, new () => Inverter>();

export function registerInverter(model: string, ctor: new () => Inverter) {
  inverters.set(model, ctor);
}

export function createInverter(model: string): Inverter {
  const ctor = inverters.get(model);
  if (!ctor) throw new Error(`Unknown inverter model: ${model}`);
  return new ctor();
}

const bmsDevices = new Map<string, new () => BMS>();

export function registerBMS(model: string, ctor: new () => BMS) {
  bmsDevices.set(model, ctor);
}

export function createBMS(model: string): BMS {
  const ctor = bmsDevices.get(model);
  if (!ctor) throw new Error(`Unknown BMS model: ${model}`);
  return new ctor();
}
