export { AnenjiInverter } from './models/dess/anenji.inverter';
export { JKBMSBms, jkBmsInstance } from './models/jkbms.bms';
export { registerInverter, createInverter, registerBMS, createBMS } from './registry';
export type { Inverter, InverterSnapshot, InverterSettings } from './interfaces/inverter.interface';
export type { BMS, BMSSnapshot } from './interfaces/bms.interface';

// Register known models
import { AnenjiInverter } from './models/dess/anenji.inverter';
import { JKBMSBms } from './models/jkbms.bms';
import { registerInverter, registerBMS } from './registry';
registerInverter('anenji-6200', AnenjiInverter);
registerBMS('JKBMS', JKBMSBms);
