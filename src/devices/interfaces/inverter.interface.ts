export interface InverterSnapshot {
  timestamp: Date;
  pvPowerW: number;
  loadPowerW: number;
  gridPowerW: number;
  batteryPowerW: number;
  batteryStatus: 1 | -1 | 0;
  batterySoc: number;
  pvVoltage: number;
  pvCurrent: number;
  pvChargingCurrent: number;
  batteryVoltage: number;
  batteryCurrent: number;
  outputVoltage: number;
  outputCurrent: number;
  outputPowerW: number;
  loadPercent: number;
  gridVoltage: number;
  gridFrequency: number;
  acChargingCurrent: number;
  operatingMode: string;
  outputPriority: string;
  chargerSourcePriority: string;
  dcModuleTemp: number;
  invModuleTemp: number;
  labels: Record<string, string>;
}

export interface InverterSettings {
  batteryType?: string;
  bulkChargingVoltage?: number;
  floatChargingVoltage?: number;
  maxChargingCurrent?: number;
  maxAcChargingCurrent?: number;
  lowDcProtectionVoltage?: number;
  offGridLowDcProtectionVoltage?: number;
  highDcProtectionVoltage?: number;
  outputSourcePriority?: string;
  chargerSourcePriority?: string;
  socDischargeProtection?: number;
}

export interface Inverter {
  readonly brand: string;
  readonly model: string;
  getSnapshot(): Promise<InverterSnapshot>;
  getSettings(): Promise<InverterSettings>;
  updateSettings(settings: Partial<InverterSettings>): Promise<void>;
}
