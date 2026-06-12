import type { BMS, BMSSnapshot } from '../interfaces/bms.interface';

/**
 * JKBMS — backend proxy for the ESP32 BMS bridge.
 *
 * Data is pushed from the ESP32 via HTTP POST /api/bms/data.
 * This class stores the latest snapshot and serves it to the automation engine.
 */
export class JKBMSBms implements BMS {
  readonly brand = 'JK';
  readonly model = 'B2A16S';

  private _lastSnapshot: BMSSnapshot | null = null;

  /** Called by the API controller when ESP32 pushes new data */
  setSnapshot(snapshot: BMSSnapshot): void {
    this._lastSnapshot = snapshot;
  }

  /** Returns the latest known snapshot (throw if never received) */
  async getSnapshot(): Promise<BMSSnapshot> {
    if (!this._lastSnapshot) {
      throw new Error('No BMS data received yet — ESP32 may not be connected');
    }
    return this._lastSnapshot;
  }

  /** Quick peek at the snapshot without throwing */
  get lastSnapshot(): BMSSnapshot | null {
    return this._lastSnapshot;
  }
}

/** Singleton shared between the controller and automation engine */
export const jkBmsInstance = new JKBMSBms();
