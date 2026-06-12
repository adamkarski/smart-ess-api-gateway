import { resolveTargetOptions, webQueryDeviceEnergyFlowEs, querySPDeviceLastData, queryDeviceParsEs, queryDeviceList } from '../../../lib/dess/dess';
import { ensureAuth } from './dess-auth.service';
import type { InverterSnapshot } from '../../interfaces/inverter.interface';

import { getPercentByVoltage } from '../../../lib/voltage-point.utils';
import { appConfig } from '../../../config';
import type { TargetOptions } from '../../../lib/dess/dess';
import type { ParameterPrefix } from './dess-api.types';

interface DessRawData {
  energyFlow: any;
  spDeviceData: any;
  parsEs: any;
  deviceList: any;
}

export async function fetchDessRawData(targetOverrides?: {
  pn?: string;
  sn?: string;
  devcode?: string;
  devaddr?: string;
}): Promise<DessRawData> {
  const auth = await ensureAuth();
  const target: TargetOptions = resolveTargetOptions({
    pn: targetOverrides?.pn,
    sn: targetOverrides?.sn,
    devcode: targetOverrides?.devcode,
    devaddr: targetOverrides?.devaddr,
  });

  const [energyFlow, spDeviceData, parsEs, deviceList] = await Promise.all([
    webQueryDeviceEnergyFlowEs(auth, target),
    querySPDeviceLastData(auth, target),
    queryDeviceParsEs(auth, target),
    queryDeviceList(auth, { sn: target.sn, pn: target.pn }),
  ]);

  return { energyFlow, spDeviceData, parsEs, deviceList };
}

function findParam(pars: any, prefix: string, id: string): string | undefined {
  const group = pars?.[prefix];
  if (!Array.isArray(group)) return undefined;
  return group.find((p: any) => p.id === id || p.par === id)?.val;
}

function findParamByLabel(pars: any, prefix: string, label: string): string | undefined {
  const group = pars?.[prefix];
  if (!Array.isArray(group)) return undefined;
  return group.find((p: any) => p.par === label)?.val;
}

export function mapToSnapshot(raw: DessRawData): InverterSnapshot {
  const flow = raw.energyFlow;
  const pars = raw.spDeviceData?.pars || {};
  const formatted = {} as any;

  const getP = (prefix: string, id: string) => findParam(pars, prefix, id);
  const getPByLabel = (prefix: string, label: string) => findParamByLabel(pars, prefix, label);

  const pvOutputPowerW = Number(getP('pv_', 'pv_output_power') || 0);
  const loadActivePowerW = Number(getP('bc_', 'bc_load_active_power') || getPByLabel('bc_', 'Output Active Power') || 0);
  const gridActivePowerW = Number(getP('gd_', 'gd_grid_active_power') || 0);

  const flowBtStatus = flow?.bt_status;
  const batteryPowerKW = flowBtStatus?.find((i: any) => i.par === 'battery_active_power')?.val || '0';
  const batteryStatus = Number(flowBtStatus?.find((i: any) => i.par === 'battery_active_power')?.status || 0);
  const batterySoc = Number(flowBtStatus?.find((i: any) => i.par === 'bt_battery_capacity')?.val || 0);

  const btBatteryVoltage = getP('bt_', 'bt_battery_voltage') || getPByLabel('bt_', 'Battery Voltage');
  const batteryRatedVoltage = Number(
    getP('sy_', 'sy_rated_battery_voltage') ||
    appConfig.dess.device.batteryVoltage,
  );
  const batteryRealLevel = getPercentByVoltage(Number(btBatteryVoltage), batteryRatedVoltage);

  const labels: Record<string, string> = {};
  Object.values(pars).forEach((group: any) => {
    if (Array.isArray(group)) {
      group.forEach((p: any) => {
        if (p.par) labels[p.id || p.par] = p.par;
      });
    }
  });

  return {
    timestamp: new Date(),
    pvPowerW: pvOutputPowerW,
    loadPowerW: loadActivePowerW,
    gridPowerW: gridActivePowerW,
    batteryPowerW: Math.round(Number(batteryPowerKW) * 1000),
    batteryStatus: (batteryStatus === 1 ? 1 : batteryStatus === -1 ? -1 : 0) as 1 | -1 | 0,
    batterySoc: batterySoc || Number(batteryRealLevel) || 0,
    pvVoltage: Number(getP('pv_', 'pv_eybond_read_32') || 0),
    pvCurrent: Number(getP('pv_', 'pv_eybond_read_33') || 0),
    pvChargingCurrent: Number(getP('pv_', 'pv_eybond_read_46') || 0),
    batteryVoltage: Number(btBatteryVoltage || 0),
    batteryCurrent: Number(getP('bt_', 'bt_eybond_read_29') || 0),
    outputVoltage: Number(getP('bc_', 'bc_eybond_read_23') || 0),
    outputCurrent: Number(getP('bc_', 'bc_eybond_read_24') || 0),
    outputPowerW: loadActivePowerW,
    loadPercent: Number(getP('bc_', 'bc_eybond_read_37') || 0),
    gridVoltage: Number(getP('gd_', 'gd_eybond_read_15') || 0),
    gridFrequency: Number(getP('gd_', 'gd_eybond_read_16') || 0),
    acChargingCurrent: Number(getP('gd_', 'gd_eybond_read_45') || 0),
    operatingMode: getPByLabel('sy_', 'Operating mode') || '',
    outputPriority: getPByLabel('sy_', 'Output priority') || '',
    chargerSourcePriority: getPByLabel('sy_', 'Charger Source Priority') || '',
    dcModuleTemp: Number(getP('sy_', 'sy_eybond_read_38') || 0),
    invModuleTemp: Number(getP('sy_', 'sy_eybond_read_39') || 0),
    labels,
  };
}
