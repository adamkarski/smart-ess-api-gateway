export interface DessAuthResponseData {
  token: string;
  secret: string;
  expire: number;
}

export interface DessAuthParams {
  token: string;
  secret: string;
}

export enum DESS_QUERY_ACTION {
  AUTH_SOURCE = 'authSource',
  WEB_QUERY_DEVICE_ENERGY_FLOW_ES = 'webQueryDeviceEnergyFlowEs',
  QUERY_SPDEVICE_LAST_DATA = 'querySPDeviceLastData',
  QUERY_DEVICE_CTRL_VALUE = 'queryDeviceCtrlValue',
  QUERY_DEVICE_PARS_ES = 'queryDeviceParsEs',
  CTRL_DEVICE = 'ctrlDevice',
  WEB_QUERY_DEVICE_ES = 'webQueryDeviceEs',
}

export enum QUERY_DEVICE_CONTROL_ID {
  bse_output_source_priority = 'bse_output_source_priority',
  bat_max_charging_current = 'bat_max_charging_current',
  bat_ac_charging_current = 'bat_ac_charging_current',
  bat_battery_cut_off_voltage = 'bat_battery_cut_off_voltage',
  bat_charging_bulk_voltage = 'bat_charging_bulk_voltage',
  bat_charging_float_voltage = 'bat_charging_float_voltage',
}

export enum ParameterPrefix {
  GRID = 'gd_',
  PV = 'pv_',
  BATTERY = 'bt_',
  BC = 'bc_',
  SYSTEM = 'sy_',
}

export interface WebQueryDeviceEnergyFlowItem {
  par: string;
  val: string;
  status?: number;
  name?: string;
}

export interface WebQueryDeviceEnergyFlowEs {
  brand?: string;
  status?: string;
  date?: string;
  bt_status?: WebQueryDeviceEnergyFlowItem[];
  pv_status?: WebQueryDeviceEnergyFlowItem[];
  gd_status?: WebQueryDeviceEnergyFlowItem[];
  bc_status?: WebQueryDeviceEnergyFlowItem[];
  ol_status?: WebQueryDeviceEnergyFlowItem[];
  we_status?: WebQueryDeviceEnergyFlowItem[];
}

export interface Parameter {
  par: string;
  name: string;
  val: string;
  unit: string;
}

export interface QuerySpdeviceLastData {
  pars: {
    gd_?: Parameter[];
    pv_?: Parameter[];
    bt_?: Parameter[];
    bc_?: Parameter[];
    sy_?: Parameter[];
    [key: string]: Parameter[] | undefined;
  };
}

export interface QueryDeviceParsEs {
  dat: {
    parameter: {
      id: string;
      par: string;
      name: string;
      val: string;
      unit: string;
    }[];
  };
}

export interface QueryDeviceCtrlValue {
  id: QUERY_DEVICE_CONTROL_ID;
  name: string;
  val: string;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  selectdata?: string[];
}

export interface DeviceInfo {
  devalias: string;
  sn: string;
  status: number;
  brand: number;
  devtype: string;
  collalias: string;
  pn: string;
  devaddr: string;
  devcode: string;
  usr: string;
  uid: number;
  profitToday: string;
  profitTotal: string;
  buyProfitToday: string;
  buyProfitTotal: string;
  sellProfitToday: string;
  sellProfitTotal: string;
  pid: number;
  focus: boolean;
  outpower: string;
  energyToday: string;
  energyYear: string;
  energyTotal: string;
  buyEnergyToday: string;
  buyEnergyTotal: string;
  sellEnergyToday: string;
  sellEnergyTotal: string;
  soc: string;
  wifiStatus: number;
  electrafyStatus: number;
  otaLabel: number;
}

export interface QueryDeviceList {
  device: DeviceInfo[];
}

export interface FormattedResponseData {
  battery_voltage: string;
  battery_status: string;
  battery_charging_current: string;
  battery_discharge_current: string;
  battery_charger_source_priority: string;
  solar_pv_voltage: string;
  solar_grid_in_voltage: string;
  solar_pv_power: string;
  output_source_priority: string;
  battery_real_level: string;
  load_active_power: string;
}
