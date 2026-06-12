export interface BMSSnapshot {
  timestamp: Date;
  cellVoltages: number[];
  cellMinVoltage: number;
  cellMaxVoltage: number;
  cellDelta: number;
  soc: number;
  current: number;
  power: number;
  totalVoltage: number;
  temperatures: number[];
  balancing: boolean;
  balancingCurrent: number;
  cycleCount: number;
  capacityRemainingAh: number;
  capacityFullAh: number;
}

export interface BMS {
  readonly brand: string;
  readonly model: string;
  getSnapshot(): Promise<BMSSnapshot>;
}
