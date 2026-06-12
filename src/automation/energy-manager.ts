import { automationState } from './state';
import { getAverageWeeklyConsumptionWatts } from '../stats/daily-stats';

export interface EnergyEstimate {
    currentSoc: number;
    currentKwh: number;
    batteryKwh: number;
    avgConsumptionKw: number;
    hoursLeft: number;
    deficitKwh: number;
    nextCheapWindowInfo: string;
    pvTodayKwh: number;
    pvTomorrowKwh: number;
    isCheapNow: boolean;
    targetSoc: number;
    energyNeededUntilNextCheap: number;
    energyNeededUntilNextPv: number;
}

export class EnergyManager {
    private static lastEstimate: EnergyEstimate | null = null;
    private static lastUpdate = 0;

    static getActiveSoc(): number {
        // Find first available SOC from inverter or BMS nodes
        const nodes = Object.values(automationState.nodes);
        
        // Priority 1: BMS nodes
        const bmsNode = nodes.find(n => n.type === 'bms' && n.data?.soc !== undefined);
        if (bmsNode) return Number(bmsNode.data.soc);

        // Priority 2: Inverter nodes with battery_soc
        const invNode = nodes.find(n => n.type === 'inverter' && n.data?.battery_soc !== undefined);
        if (invNode) return Number(invNode.data.battery_soc);

        return 50; // Default fallback
    }

    static getAvgConsumptionKw(): number {
        const avgWatts = getAverageWeeklyConsumptionWatts();
        return avgWatts / 1000;
    }

    static getSolarForecast(): { today: number; tomorrow: number; hourly: number[] } {
        const weatherNode = Object.values(automationState.nodes).find(n => n.type === 'weather');
        if (!weatherNode || !weatherNode.data) {
            return { today: 0, tomorrow: 0, hourly: Array(24).fill(0) };
        }

        const todaySum = weatherNode.data.expected_pv_today_sum_kwh || 0;
        const tomorrowSum = (weatherNode.data.expected_pv_daily_sum_kwh || [])[1] || 0;
        const hourly = weatherNode.data.expected_pv_hourly || Array(24).fill(0);

        return { today: todaySum, tomorrow: tomorrowSum, hourly };
    }

    static getNextCheapWindow(): { start: string; end: string; hoursUntil: number; isNow: boolean } {
        const tariff = automationState.settings.tariff;
        if (!tariff) return { start: '--:--', end: '--:--', hoursUntil: 24, isNow: false };

        const now = new Date();
        const currentMin = now.getHours() * 60 + now.getMinutes();
        
        const isOffpeak = (min: number) => {
            const m = min % 1440;
            for (const range of tariff.offpeakRanges) {
                const [sh, sm] = range.start.split(':').map(Number);
                const [eh, em] = range.end.split(':').map(Number);
                const s = sh * 60 + sm;
                const e = eh * 60 + em;
                if (s <= e) {
                    if (m >= s && m < e) return true;
                } else {
                    if (m >= s || m < e) return true;
                }
            }
            return false;
        };

        const isNow = isOffpeak(currentMin);
        
        let hoursUntil = 0;
        let windowStart = '--:--';
        let windowEnd = '--:--';

        if (isNow) {
            // Find when it ends
            for (let m = 1; m < 1440; m++) {
                if (!isOffpeak(currentMin + m)) {
                    const end = new Date(now.getTime() + m * 60000);
                    windowEnd = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
                    break;
                }
            }
            windowStart = 'TERAZ';
        } else {
            // Find when it starts
            for (let m = 1; m < 1440; m++) {
                if (isOffpeak(currentMin + m)) {
                    hoursUntil = m / 60;
                    const start = new Date(now.getTime() + m * 60000);
                    windowStart = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
                    
                    // Find when this future window ends
                    for (let e = m + 1; e < m + 1440; e++) {
                        if (!isOffpeak(currentMin + e)) {
                            const end = new Date(now.getTime() + e * 60000);
                            windowEnd = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
                            break;
                        }
                    }
                    break;
                }
            }
        }

        return { start: windowStart, end: windowEnd, hoursUntil, isNow };
    }

    static calculateEstimate(): EnergyEstimate {
        const now = Date.now();
        if (this.lastEstimate && now - this.lastUpdate < 30000) {
            return this.lastEstimate;
        }

        const soc = this.getActiveSoc();
        const batteryKwh = automationState.settings.solar.batteryKwh || 16;
        const currentKwh = (soc / 100) * batteryKwh;
        const avgKw = this.getAvgConsumptionKw();
        const solar = this.getSolarForecast();
        const cheapWindow = this.getNextCheapWindow();

        const minSafeKwh = batteryKwh * 0.2;
        const usableKwh = Math.max(0, currentKwh - minSafeKwh);
        const hoursLeft = avgKw > 0 ? usableKwh / avgKw : 99;

        const consumptionUntilCheap = avgKw * cheapWindow.hoursUntil;
        const energyNeededUntilNextCheap = Math.max(0, consumptionUntilCheap - usableKwh);

        const currentHour = new Date().getHours();
        let hoursUntilPv = 0;
        if (currentHour >= 18 || currentHour < 6) {
            hoursUntilPv = currentHour >= 18 ? (24 - currentHour + 6) : (6 - currentHour);
        }
        const energyNeededUntilNextPv = Math.max(0, (avgKw * hoursUntilPv) - usableKwh);

        const deficitKwh = Math.max(energyNeededUntilNextCheap, energyNeededUntilNextPv);
        const targetSoc = Math.min(100, ((usableKwh + deficitKwh) / batteryKwh) * 100 + 20);

        let nextInfo = '';
        if (cheapWindow.isNow) {
            nextInfo = `tania do ${cheapWindow.end}`;
        } else {
            nextInfo = `tania od ${cheapWindow.start}`;
        }

        this.lastEstimate = {
            currentSoc: soc,
            currentKwh: Math.round(currentKwh * 100) / 100,
            batteryKwh,
            avgConsumptionKw: avgKw,
            hoursLeft: Math.round(hoursLeft * 10) / 10,
            deficitKwh: Math.round(deficitKwh * 100) / 100,
            nextCheapWindowInfo: nextInfo,
            pvTodayKwh: solar.today,
            pvTomorrowKwh: solar.tomorrow,
            isCheapNow: cheapWindow.isNow,
            targetSoc: Math.round(targetSoc),
            energyNeededUntilNextCheap: Math.round(energyNeededUntilNextCheap * 100) / 100,
            energyNeededUntilNextPv: Math.round(energyNeededUntilNextPv * 100) / 100,
        };
        this.lastUpdate = now;
        return this.lastEstimate;
    }
}
