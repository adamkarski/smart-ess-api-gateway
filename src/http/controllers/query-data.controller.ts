import { authRenewCheck, formatAuthData, performAuth } from '../../actions/auth-service';
import { queryDeviceList, resolveTargetOptions, TargetOptions } from '../../lib/dess/dess';
import * as dess from '../../lib/dess/dess';
import { ParameterPrefix } from '../../lib/dess/dess-api.types';
import { appConfig } from '../../config';
import { getPercentByVoltage } from '../../lib/voltage-point.utils';
import { ResponseDessHttpData } from '../responses';
import { gauge } from '../../metrics/prom';

export async function controllerGetData(query: {
  pn?: string;
  sn?: string;
  devcode?: string;
  devaddr?: string;
  battery_voltage?: string;
  name?: string;
  auth_username?: string;
  auth_password?: string;
  auth_hash_password?: string;
}) {
  const hasRequestAuthData =
    query?.auth_username?.length &&
    (query?.auth_password?.length || query?.auth_hash_password?.length);
  const auth = formatAuthData(
    hasRequestAuthData
      ? await performAuth({
          username: query?.auth_username,
          hashPassword: query?.auth_hash_password,
          plainPassword: query?.auth_password,
        })
      : await authRenewCheck(),
  );
  const target: TargetOptions = resolveTargetOptions({
    pn: query['pn'],
    sn: query['sn'],
    devcode: query['devcode'],
    devaddr: query['devaddr'],
    name: query['name'],
  });
  const [
    webQueryDeviceEnergyFlowEs,
    querySPDeviceLastData,
    queryDeviceParsEs,
    queryDeviceList,
  ] = await Promise.all([
    dess.webQueryDeviceEnergyFlowEs(auth, target),
    dess.querySPDeviceLastData(auth, target),
    dess.queryDeviceParsEs(auth, target),
    dess.queryDeviceList(auth, {
      sn: target.sn,
      pn: target.pn,
    }),
  ]);

  const getParameter = (prefix: ParameterPrefix, parameter: string) => {
    const group = querySPDeviceLastData.pars[prefix];
    if (!group) return undefined;
    const item = group.find((i) => i.id === parameter);
    if (item) return item.val;
    
    // Fallback: search by name/label
    const labelMap: Record<string, string> = {
      'bt_battery_voltage': 'Battery Voltage',
      'bt_battery_status': 'Battery Status',
      'bt_battery_charging_current': 'Battery Current',
      'bt_battery_discharge_current': 'Battery Discharge Current',
      'bt_charger_source_priority': 'Charger Source Priority',
      'pv_input_voltage': 'PV Voltage',
      'pv_output_power': 'PV Power',
      'gd_ac_input_voltage': 'Grid Voltage',
      'bc_output_source_priority': 'Output priority',
      'bc_load_active_power': 'Output Active Power'
    };
    const label = labelMap[parameter];
    if (label) {
      const byLabel = group.find((i) => i.par === label);
      if (byLabel) return byLabel.val;
    }
    return undefined;
  };

  const inverterDataRatedBatteryVoltage = getParameter(
    ParameterPrefix.SYSTEM,
    'sy_rated_battery_voltage',
  );
  const batteryRatedVoltage = Number(
    query['battery_voltage'] ??
      inverterDataRatedBatteryVoltage ??
      appConfig.dess.device.batteryVoltage,
  );
  const bt_battery_voltage = getParameter(
    ParameterPrefix.BATTERY,
    'bt_battery_voltage',
  );
  const bt_charger_source_priority = getParameter(
    ParameterPrefix.BATTERY,
    'bt_charger_source_priority',
  );
  const bt_battery_status = getParameter(
    ParameterPrefix.BATTERY,
    'bt_battery_status',
  );
  const bt_battery_charging_current = getParameter(
    ParameterPrefix.BATTERY,
    'bt_battery_charging_current',
  );
  const bt_battery_discharge_current = getParameter(
    ParameterPrefix.BATTERY,
    'bt_battery_discharge_current',
  );

  const solar_pv_voltage = getParameter(ParameterPrefix.PV, 'pv_input_voltage');
  const solar_grid_in_voltage = getParameter(
    ParameterPrefix.GRID,
    'gd_ac_input_voltage',
  );
  const solar_pv_power = getParameter(ParameterPrefix.PV, 'pv_output_power');
  const output_source_priority = getParameter(
    ParameterPrefix.BC,
    'bc_output_source_priority',
  );
  const battery_real_level = getPercentByVoltage(
    Number(bt_battery_voltage),
    batteryRatedVoltage,
  ).toFixed(1);
  const load_active_power =
    webQueryDeviceEnergyFlowEs.bc_status?.find(
      (i) => i.par === 'load_active_power',
    )?.val || '0';
  const payload: ResponseDessHttpData = {
    target,
    webQueryDeviceEnergyFlowEs,
    querySPDeviceLastData,
    queryDeviceParsEs,
    deviceData: queryDeviceList.device[0],
    formattedData: {
      battery_voltage: bt_battery_voltage,
      battery_status: bt_battery_status,
      battery_charging_current: bt_battery_charging_current,
      battery_discharge_current: bt_battery_discharge_current,
      battery_charger_source_priority: bt_charger_source_priority,
      solar_pv_voltage,
      solar_grid_in_voltage,
      solar_pv_power,
      output_source_priority,
      battery_real_level,
      load_active_power,
    },
  };

  gauge.set(
    { sn: payload.target.sn, sensor: 'pv_power' },
    +payload.formattedData.solar_pv_power,
  );
  gauge.set(
    { sn: payload.target.sn, sensor: 'battery_voltage' },
    +payload.formattedData.battery_voltage,
  );
  gauge.set(
    { sn: payload.target.sn, sensor: 'battery_charging_current' },
    +payload.formattedData.battery_charging_current,
  );
  gauge.set(
    { sn: payload.target.sn, sensor: 'battery_discharge_current' },
    +payload.formattedData.battery_discharge_current,
  );
  gauge.set(
    { sn: payload.target.sn, sensor: 'solar_grid_in_voltage' },
    +payload.formattedData.solar_grid_in_voltage,
  );
  gauge.set(
    { sn: payload.target.sn, sensor: 'solar_pv_voltage' },
    +payload.formattedData.solar_pv_voltage,
  );
  gauge.set(
    { sn: payload.target.sn, sensor: 'load_active_power' },
    +payload.formattedData.load_active_power * 1000,
  );

  return payload;
}

export async function getInverterSnapshot() {
  const { createInverter } = await import('../../devices');
  const { automationState } = await import('../../automation/state');
  const model = automationState.settings.inverter?.model || 'anenji-6200';
  const inverter = createInverter(model);
  return inverter.getSnapshot();
}
