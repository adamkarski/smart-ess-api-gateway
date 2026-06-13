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
    nextPvWindowInfo: string;
    requiredChargeMinutes: number;
    chargePowerKw: number;
    minProjectedSoc: number;
    nextChargeSource: string;
    nextChargeHours: number;
    nextChargeInfo: string;
}

export class EnergyManager {
    private static lastEstimate: EnergyEstimate | null = null;
    private static lastUpdate = 0;

    static getActiveSoc(): number {
        const nodes = Object.values(automationState.nodes);

        const bmsNode = nodes.find(n => n.type === 'bms' && n.data?.soc !== undefined);
        if (bmsNode) return Number(bmsNode.data.soc);

        const invNode = nodes.find(n => n.type === 'inverter' && n.data?.battery_soc !== undefined);
        if (invNode) return Number(invNode.data.battery_soc);

        return 50;
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

    /** Get PV forecast in kW for a given hour offset from now (0 = current hour) */
    private static getPvKwAtOffset(hourOffset: number): number {
        const weatherNode = Object.values(automationState.nodes).find(n => n.type === 'weather');
        if (!weatherNode?.data) return 0;

        const currentHour = new Date().getHours();
        const absoluteHour = (currentHour + hourOffset) % 24;
        const dayOffset = Math.floor((currentHour + hourOffset) / 24);

        if (dayOffset === 0) {
            const hourly = weatherNode.data.expected_pv_hourly;
            if (hourly?.[absoluteHour]) return hourly[absoluteHour] / 1000;
        }

        const forecastHourly = weatherNode.data.forecast_hourly;
        if (forecastHourly?.[dayOffset]?.[absoluteHour]) {
            return forecastHourly[dayOffset][absoluteHour] / 1000;
        }

        return 0;
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
            for (let m = 1; m < 1440; m++) {
                if (!isOffpeak(currentMin + m)) {
                    const end = new Date(now.getTime() + m * 60000);
                    windowEnd = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
                    break;
                }
            }
            windowStart = 'TERAZ';
        } else {
            for (let m = 1; m < 1440; m++) {
                if (isOffpeak(currentMin + m)) {
                    hoursUntil = m / 60;
                    const start = new Date(now.getTime() + m * 60000);
                    windowStart = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;

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

        const batteryVoltage = automationState.settings.dess?.batteryVoltage || 48;
        const chargeCurrentA = automationState.settings.solar?.chargeCurrentA || 40;
        const chargePowerKw = (batteryVoltage * chargeCurrentA) / 1000;

        const minReserveKwh = batteryKwh * 0.2;
        const usableKwh = Math.max(0, currentKwh - minReserveKwh);
        const hoursLeft = avgKw > 0 ? usableKwh / avgKw : 99;

        // --- Hour-by-hour simulation to find next PV charging opportunity ---
        let projectedKwh = currentKwh;
        let minProjectedKwh = currentKwh;
        let nextPvHourOffset = -1;
        const maxLookahead = 48;

        // Check current hour too (offset 0)
        const currentPvKw = this.getPvKwAtOffset(0);
        if (currentPvKw > avgKw && currentKwh < batteryKwh) {
            nextPvHourOffset = 0;
        }

        if (nextPvHourOffset < 0) {
            for (let i = 1; i <= maxLookahead; i++) {
                const pvKw = this.getPvKwAtOffset(i);
                const netKwh = pvKw - avgKw;
                projectedKwh += netKwh;
                projectedKwh = Math.max(0, Math.min(projectedKwh, batteryKwh));
                if (projectedKwh < minProjectedKwh) minProjectedKwh = projectedKwh;

                if (netKwh > 0 && projectedKwh < batteryKwh) {
                    nextPvHourOffset = i;
                    break;
                }
            }
        }

        // --- Energy needed to bridge until next cheap tariff ---
        const consumptionUntilCheap = avgKw * cheapWindow.hoursUntil;
        const energyNeededUntilNextCheap = Math.max(0, consumptionUntilCheap - usableKwh);

        // --- Energy needed to bridge until next PV charging ---
        let energyNeededUntilNextPv: number;
        let nextPvWindowInfo: string;

        if (nextPvHourOffset >= 0) {
            const solarDeficit = Math.max(0, minReserveKwh - minProjectedKwh);
            energyNeededUntilNextPv = Math.max(0, solarDeficit);
            if (nextPvHourOffset === 0) {
                nextPvWindowInfo = 'PV teraz';
            } else {
                const targetDate = new Date(Date.now() + nextPvHourOffset * 3600000);
                nextPvWindowInfo = `PV za ${nextPvHourOffset}h (${String(targetDate.getHours()).padStart(2, '0')}:00)`;
            }
        } else {
            const currentHour = new Date().getHours();
            let hoursUntilPv = 0;
            if (currentHour >= 18 || currentHour < 6) {
                hoursUntilPv = currentHour >= 18 ? (24 - currentHour + 6) : (6 - currentHour);
            }
            energyNeededUntilNextPv = Math.max(0, (avgKw * hoursUntilPv) - usableKwh);
            nextPvWindowInfo = hoursUntilPv > 0 ? `PV ~${hoursUntilPv}h` : 'PV teraz';
        }

        const deficitKwh = Math.max(energyNeededUntilNextCheap, energyNeededUntilNextPv);
        const targetSoc = Math.min(100, ((usableKwh + deficitKwh) / batteryKwh) * 100 + 20);

        // Charging time at constant charge power
        const requiredChargeMinutes = chargePowerKw > 0
            ? Math.ceil((deficitKwh / chargePowerKw) * 60)
            : 0;
        const minProjectedSoc = Math.round((minProjectedKwh / batteryKwh) * 100);

        let nextInfo = '';
        if (cheapWindow.isNow) {
            nextInfo = `tania do ${cheapWindow.end}`;
        } else {
            nextInfo = `tania od ${cheapWindow.start}`;
        }

        // --- Determine next charge source ---
        let nextChargeSource: string;
        let nextChargeHours: number;
        let nextChargeInfo: string;

        const chargeNeeded = deficitKwh > 0.3 && soc < 85;

        if (!chargeNeeded) {
            nextChargeSource = 'BATERIA';
            nextChargeHours = 99;
            nextChargeInfo = 'bateria OK';
        } else if (nextPvHourOffset >= 0 && (nextPvHourOffset === 0 || nextPvHourOffset <= cheapWindow.hoursUntil)) {
            nextChargeSource = 'PV';
            nextChargeHours = nextPvHourOffset;
            if (nextPvHourOffset === 0) {
                nextChargeInfo = 'za chwilę';
            } else {
                nextChargeInfo = formatTimeUntil(nextPvHourOffset);
            }
        } else if (cheapWindow.isNow) {
            nextChargeSource = 'TAURON';
            nextChargeHours = 0;
            nextChargeInfo = 'za chwilę';
        } else if (cheapWindow.hoursUntil < 24) {
            nextChargeSource = 'TAURON';
            nextChargeHours = cheapWindow.hoursUntil;
            nextChargeInfo = formatTimeUntil(cheapWindow.hoursUntil);
        } else {
            nextChargeSource = 'BRAK';
            nextChargeHours = 99;
            nextChargeInfo = '---';
        }

        this.lastEstimate = {
            currentSoc: soc,
            currentKwh: Math.round(currentKwh * 100) / 100,
            batteryKwh,
            avgConsumptionKw: Math.round(avgKw * 1000) / 1000,
            hoursLeft: Math.round(hoursLeft * 10) / 10,
            deficitKwh: Math.round(deficitKwh * 100) / 100,
            nextCheapWindowInfo: nextInfo,
            pvTodayKwh: solar.today,
            pvTomorrowKwh: solar.tomorrow,
            isCheapNow: cheapWindow.isNow,
            targetSoc: Math.round(targetSoc),
            energyNeededUntilNextCheap: Math.round(energyNeededUntilNextCheap * 100) / 100,
            energyNeededUntilNextPv: Math.round(energyNeededUntilNextPv * 100) / 100,
            nextPvWindowInfo,
            requiredChargeMinutes,
            chargePowerKw: Math.round(chargePowerKw * 100) / 100,
            minProjectedSoc,
            nextChargeSource,
            nextChargeHours,
            nextChargeInfo,
        };
        this.lastUpdate = now;
        return this.lastEstimate;
    }
}

function formatTimeUntil(hours: number): string {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `za ${h}h ${m}min` : `za ${h}h`;
}
