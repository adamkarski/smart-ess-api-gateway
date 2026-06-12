import type { Inverter, InverterSnapshot, InverterSettings } from '../../interfaces/inverter.interface';
import { fetchDessRawData, mapToSnapshot } from './dess.client';

export class AnenjiInverter implements Inverter {
  readonly brand = 'ANENJI';
  readonly model = '6200';

  async getSnapshot(): Promise<InverterSnapshot> {
    const raw = await fetchDessRawData();
    return mapToSnapshot(raw);
  }

  async getSettings(): Promise<InverterSettings> {
    return {};
  }

  async updateSettings(_settings: Partial<InverterSettings>): Promise<void> {
    // Not supported via DESS cloud API for this model
  }
}
