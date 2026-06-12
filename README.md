### Home Assistant Native component
Initial alpha version of custom Home Assistant component
https://github.com/Antoxa1081/home-assistant-dess-monitor

### Api Gateway
Go to https://www.dessmonitor.com and get your inverter SN and datalogger PN
and get your datalogger protocol ID (4 numbers), devadress (1 number) - Select object > Device Info > table with fields

Fill up .env with

```dotenv
DESS_AUTH_USERNAME=username
# You need to choose one of the options: 
# plain password (DESS_AUTH_PASSWORD) 
# or hash (DESS_AUTH_PASSWORD_HASH)
# both not allowed
DESS_AUTH_PASSWORD=password(optional)
DESS_AUTH_PASSWORD_HASH=sha1password(optional)

DESS_DEVICE_PN=Q0000000000000 #your PN
DESS_DEVICE_SN=55555555555555 #your SN
DESS_DEVICE_DEVCODE=2428 #your protocol ID
DESS_DEVICE_DEVADDR=5 #your protocol devadress
DEVICE_BATTERY_VOLTAGE=48 #your battery voltage
```

Build and start server. Listening by default on 3000 port
<br>
Or use complete docker image https://hub.docker.com/r/antoxa1081/smart-ess-api-gateway

<br>

## Project Status: PV Monitor Pro (Offline-First Edition)

### ✅ Completed Features

#### 1. Architecture & Service
- **macOS System Service:** Automated startup and lifecycle management via `./manage.sh`.
- **Background Engine:** Real-time automation engine processing logic cycles every few seconds/minutes.
- **Persistence:** All configurations, node positions, and logic links are stored locally in `data/automation.json`.

#### 2. Tuya Local Subsystem (Offline-First)
- **Direct LAN Control:** Communication via `tuyapi` directly over WiFi (Port 6668). No cloud required for operation.
- **Resilient Mapping:** Uses `internal_app_id` to protect automations from hardware resets. Logic is preserved even if Device ID or Local Key changes.
- **On-Demand Sync:** Cloud API used only on request to fetch/update cryptographic keys.
- **Intelligent Merge:** Merges cloud data by ID or Name to prevent duplication.

#### 3. Visual Flow Builder (Automation)
- **Interactive Canvas:** Draggable device nodes with real-time data overlays.
- **SVG Linking:** Visual "cables" connecting outputs to inputs for data pipelining.
- **In-Node Logic:** Each node (Inverter, Weather, Tuya) has its own logic settings (Parameter -> Operator -> Threshold).
- **Console Output:** Dedicated "Action Console" node for real-time debugging of logic results.

#### 4. Restored Dashboard
- **Rich Metrics:** PV Power (W), Energy Today (kWh), SOC (%), Battery ETA (hours left).
- **Net Balance:** Detailed Import/Export metrics with visual progress bar.
- **Animations:** Glow effects for charging/discharging and live status indicators.

### 🛠️ Still To Do (Roadmap)

- [ ] **Advanced Graph Traversal:** Improve the backend to handle complex chains (Node A -> Node B -> Node C) with full conditional branching.
- [ ] **Granular Tuya Actions:** Allow selecting specific DPS and values for actions (currently defaults to Power ON/OFF).
- [ ] **Mobile Optimization:** Adapt the Flow Builder canvas for touch devices.
- [ ] **Data History Persistence:** Store long-term energy stats in a local database (SQLite/NeDB) for historical charts.
- [ ] **Cloud Plan Monitor:** Add a specific warning in the UI when the Tuya Cloud Development plan expires.
- [ ] **Security:** Add basic password protection for the web interface.

---
*Original HA configuration reference*

```yaml
rest:
  - resource: "http://localhost:3000/data"
    sensor:
      - name: "solar_inverter_pv_output_power"
        unique_id: "solar_inverter_pv_output_power"
        value_template: "{{ value_json.formattedData.solar_pv_power }}"
        device_class: power
        unit_of_measurement: "W"

      - name: "solar_inverter_load_active_power"
        value_template: "{{ value_json.webQueryDeviceEnergyFlowEs.bc_status|selectattr('par', 'equalto', 'load_active_power')|map(attribute='val')|first|float }}"
        device_class: power
        unit_of_measurement: "kW"

      - name: "solar_inverter_gd_grid_voltage"
        value_template: "{{ value_json.formattedData.solar_grid_in_voltage }}"
        device_class: voltage
        unit_of_measurement: "V"

      - name: "solar_inverter_pv_voltage"
        value_template: "{{ value_json.formattedData.solar_pv_voltage }}"
        device_class: voltage
        unit_of_measurement: "V"

      - name: "solar_inverter_pv_input_current"
        value_template: "{{ 0 }}"
        device_class: current
        unit_of_measurement: "A"

      - name: "solar_inverter_bt_discharge_current"
        value_template: "{{ value_json.formattedData.battery_discharge_current }}"
        device_class: current
        unit_of_measurement: "A"

      - name: "solar_inverter_bt_battery_voltage"
        value_template: "{{ value_json.formattedData.battery_voltage }}"
        device_class: voltage
        unit_of_measurement: "V"


      - name: "solar_inverter_bt_real_level"
        value_template: "{{ value_json.formattedData.battery_real_level }}"
        device_class: battery
        unit_of_measurement: "%"


      - name: "solar_inverter_bt_charging_current"
        value_template: "{{ value_json.formattedData.battery_charging_current }}"
        device_class: current
        unit_of_measurement: "A"

      - name: "solar_inverter_priority"
        value_template: "{{ value_json.formattedData.output_source_priority }}"
        device_class: enum

      - name: "solar_inverter_battery_status"
        value_template: "{{ value_json.formattedData.battery_status }}"
        device_class: enum

      - name: "solar_inverter_battery_charger_source_priority"
        value_template: "{{ value_json.formattedData.battery_charger_source_priority }}"
        device_class: enum

rest_command:
  solar_inverter_set_output_priority:
    url: "http://localhost:3000/settings-set?id=los_output_source_priority&value={{ source_type_index }}" # Utility, Solar, SBU
  solar_inverter_change_priority_usb:
    url: "http://localhost:3000/settings-set?id=los_output_source_priority&value=0"
  solar_inverter_change_priority_sol:
    url: "http://localhost:3000/settings-set?id=los_output_source_priority&value=1"
  solar_inverter_change_priority_sbu:
    url: "http://localhost:3000/settings-set?id=los_output_source_priority&value=2"



  solar_inverter_set_charge_utility_current:
    url: "http://localhost:3000/settings-set?id=bat_max_utility_charge_current&value={{ charge_current }}"
  solar_inverter_charge_utility_current_fast:
    url: "http://localhost:3000/settings-set?id=bat_max_utility_charge_current&value=30"
  solar_inverter_charge_utility_current_default:
    url: "http://localhost:3000/settings-set?id=bat_max_utility_charge_current&value=20"
  solar_inverter_charge_utility_current_slow:
    url: "http://localhost:3000/settings-set?id=bat_max_utility_charge_current&value=10"


  solar_inverter_set_charger_priority:
    url: "http://localhost:3000/settings-set?id=bat_charger_source_priority&value={{ charger_priority_index }}" # Solar priority, Solar and mains, Solar only

```

Energy sensor config (for Energy dashboard) before [2024.7.0](https://github.com/Olen/homeassistant-plant/releases/tag/v2024.7.0)
```yaml
sensor:
  - platform: integration
    source: sensor.solar_inverter_pv_output_power
    name: solar_energy_produce
    round: 2
    method: trapezoidal
    unit_time: h

  - platform: integration
    source: sensor.solar_inverter_battery_power_in
    name: solar_battery_energy_in
    round: 2
    method: trapezoidal
    unit_time: h

  - platform: integration
    source: sensor.solar_inverter_battery_power_out
    name: solar_battery_energy_out
    round: 2
    method: trapezoidal
    unit_time: h
```
Energy sensor config after [2024.7.0](https://github.com/Olen/homeassistant-plant/releases/tag/v2024.7.0)
```yaml
sensor:
  - platform: integration
    source: sensor.solar_inverter_pv_output_power
    name: solar_energy_produce
    round: 2
    unit_time: h
    max_sub_interval:
      minutes: 5

  - platform: integration
    source: sensor.solar_inverter_battery_power_in
    name: solar_battery_energy_in
    round: 2
    unit_time: h
    max_sub_interval:
      minutes: 5

  - platform: integration
    source: sensor.solar_inverter_battery_power_out
    name: solar_battery_energy_out
    round: 2
    unit_time: h
    max_sub_interval:
      minutes: 5
```
<img src="https://github.com/user-attachments/assets/70ac8281-8f55-4b37-9d6b-dfbf73a03afd" width=20% height=20%>

<img src="https://github.com/user-attachments/assets/af6cf353-2c3a-4ceb-bfa1-bba1de5949e7" width=20% height=20%>

Available routes to fetch data:

- GET /devices -> QueryDevice[]

```ts
interface QueryDevice {
  devalias: string;
  sn: string;
  status: number;
  brand: number;
  devtype: string;
  collalias: string;
  pn: string;
  devaddr: number;
  devcode: number;
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
}
```

- GET /data -> ResponseDessHttpData
- Available query params (for to get info from other devices)

```
pn
sn
devcode
devaddr
```

```
/data?pn=Q0000000000000&sn=55555555555555&devcode=2428&devaddr=5
```

```json
{
  "target": {
    "pn": "Q0000000000000",
    "sn": "55555555555555",
    "devcode": "2428",
    "devaddr": "5",
    "source": "1"
  },
  "webQueryDeviceEnergyFlowEs": {
    "brand": 0,
    "status": 0,
    "date": "2024-09-16 06:58:04",
    "bt_status": [
      {
        "par": "bt_battery_capacity",
        "val": "100.0000",
        "unit": "%",
        "status": -1
      },
      {
        "par": "battery_active_power",
        "val": "0",
        "status": 0
      }
    ],
    "pv_status": [
      {
        "par": "pv_output_power",
        "val": "0.0010",
        "unit": "kW",
        "status": 1
      }
    ],
    "gd_status": [
      {
        "par": "grid_active_power",
        "val": "0",
        "status": 1
      }
    ],
    "bc_status": [
      {
        "par": "load_active_power",
        "val": "0.1540",
        "unit": "kW",
        "status": -1
      }
    ],
    "ol_status": [
      {
        "par": "oil_output_power",
        "val": "0",
        "status": 0
      }
    ],
    "we_status": [
      {
        "par": "wind_output_power",
        "val": "0",
        "status": 0
      }
    ],
    "mi_status": [],
    "mt_status": [],
    "wp_status": []
  },
  "querySPDeviceLastData": {
    "gts": "2024-09-16 00:52:47",
    "pars": {
      "gd_": [
        {
          "id": "gd_grid_voltage",
          "par": "Grid voltage",
          "val": "241.10",
          "unit": "V"
        },
        {
          "id": "gd_grid_frequency",
          "par": "Grid frequency",
          "val": "50.00",
          "unit": "Hz"
        }
      ],
      "pv_": [
        {
          "id": "pv_input_current",
          "par": "PV Input current for battery",
          "val": "0.00",
          "unit": "A"
        },
        {
          "id": "pv_output_power",
          "par": "PV Charging power",
          "val": "1.00",
          "unit": "W"
        },
        {
          "id": "pv_voltage",
          "par": "PV Input voltage",
          "val": "0.00",
          "unit": "V"
        }
      ],
      "bt_": [
        {
          "id": "bt_discharge_current",
          "par": "Battery discharge current",
          "val": "0.00",
          "unit": "A"
        },
        {
          "id": "bt_battery_voltage",
          "par": "Battery voltage",
          "val": "27.00",
          "unit": "V"
        },
        {
          "id": "bt_charging_current",
          "par": "Battery charging current",
          "val": "0.00",
          "unit": "A"
        },
        {
          "id": "bt_battery_capacity",
          "par": "Battery capacity",
          "val": "100.00",
          "unit": "%"
        }
      ],
      "bc_": [
        {
          "id": "bc_load_percent",
          "par": "Output load percent",
          "val": "5.00",
          "unit": "%"
        },
        {
          "id": "bc_output_frequency",
          "par": "AC output frequency",
          "val": "50.00",
          "unit": "Hz"
        },
        {
          "id": "bc_output_voltage",
          "par": "AC output voltage",
          "val": "241.10",
          "unit": "V"
        }
      ]
    }
  },
  "queryDeviceParsEs": {
    "parameter": [
      {
        "par": "bt_battery_voltage",
        "name": "Battery voltage",
        "val": "27.0000",
        "unit": "V"
      },
      {
        "par": "bt_charging_current",
        "name": "Battery charging current",
        "val": "0.0000",
        "unit": "A"
      },
      {
        "par": "bt_discharge_current",
        "name": "Battery discharge current",
        "val": "0.0000",
        "unit": "A"
      },
      {
        "par": "gd_grid_voltage",
        "name": "Grid voltage",
        "val": "240.2000",
        "unit": "V"
      },
      {
        "par": "load_active_power",
        "name": "AC output active power",
        "val": "0.1540",
        "unit": "kW"
      },
      {
        "par": "pv_input_current",
        "name": "PV Input current for battery",
        "val": "0.0000",
        "unit": "A"
      }
    ]
  }
}
```

- GET /settings -> ResponseDessHttpSettings

```json
{
  "settings": [
    {
      "id": "bse_output_source_priority_read",
      "name": "Output source priority rating",
      "val": "Utility first"
    },
    {
      "id": "bat_max_charging_current_read",
      "name": "Current rating charging current",
      "val": "50.00"
    },
    {
      "id": "bat_ac_charging_current_read",
      "name": "Current max AC rating  current",
      "val": "30.00"
    },
    {
      "id": "bat_battery_cut_off_voltage_read",
      "name": "Battery rating under voltage",
      "val": "22.00"
    },
    {
      "id": "bat_charging_bulk_voltage_read",
      "name": "Battery rating bulk voltage",
      "val": "29.20"
    },
    {
      "id": "bat_charging_float_voltage_read",
      "name": "Battery rating float voltage",
      "val": "27.00"
    }
  ]
}
```

*Example responses for protocol id - 2428

```json
{
  "webQueryDeviceEnergyFlowEs": {
    "brand": 2,
    "status": 0,
    "date": "2024-09-16 07:14:51",
    "bt_status": [
      {
        "par": "bt_battery_capacity",
        "val": "100.0000",
        "unit": "%",
        "status": -1
      },
      {
        "par": "battery_active_power",
        "val": "0",
        "status": 0
      }
    ],
    "pv_status": [
      {
        "par": "pv_output_power",
        "val": "0.0000",
        "unit": "kW",
        "status": 0
      }
    ],
    "gd_status": [
      {
        "par": "grid_active_power",
        "val": "0",
        "status": 1
      }
    ],
    "bc_status": [
      {
        "par": "load_active_power",
        "val": "0.2490",
        "unit": "kW",
        "status": -1
      }
    ],
    "ol_status": [
      {
        "par": "oil_output_power",
        "val": "0",
        "status": 0
      }
    ],
    "we_status": [
      {
        "par": "wind_output_power",
        "val": "0",
        "status": 0
      }
    ],
    "mi_status": [],
    "mt_status": [],
    "wp_status": []
  },
  "querySPDeviceLastData": {
    "gts": "2024-09-16 01:12:40",
    "pars": {
      "gd_": [
        {
          "id": "gd_ac_input_frequency",
          "par": "AC Input Frequency",
          "val": "49.9",
          "unit": "Hz"
        },
        {
          "id": "gd_mains_status",
          "par": "Mains Status",
          "val": "Mains Discharge"
        },
        {
          "id": "gd_ac_input_voltage",
          "par": "AC Input Voltage",
          "val": "226.8",
          "unit": "V"
        },
        {
          "id": "gd_ac_input_range",
          "par": "AC Input Range",
          "val": "UPS"
        }
      ],
      "sy_": [
        {
          "id": "sy_status",
          "par": "Working State",
          "val": "Line Mode"
        },
        {
          "id": "sy_nonimal_output_apparent_power",
          "par": "Nonimal Output Apparent Power",
          "val": "6200",
          "unit": "VA"
        },
        {
          "id": "sy_nominal_output_voltage",
          "par": "Nominal Output Voltage",
          "val": "230",
          "unit": "V"
        },
        {
          "id": "sy_nominal_output_frequency",
          "par": "Nominal Output Frequency",
          "val": "50.0",
          "unit": "Hz"
        },
        {
          "id": "sy_main_cpu_version",
          "par": "Main CPU Version",
          "val": "8006"
        },
        {
          "id": "sy_nonimal_output_active_power",
          "par": "Nonimal Output Active Power",
          "val": "6200",
          "unit": "W"
        },
        {
          "id": "sy_nominal_output_current",
          "par": "Nominal Output Current",
          "val": "26",
          "unit": "A"
        },
        {
          "id": "sy_rated_battery_voltage",
          "par": "Rated Battery Voltage",
          "val": "48.0",
          "unit": "V"
        },
        {
          "id": "sy_nominal_ac_current",
          "par": "Nominal AC Current",
          "val": "26",
          "unit": "A"
        },
        {
          "id": "sy_secondary_cpu_version",
          "par": "Secondary CPU Version",
          "val": "0"
        },
        {
          "id": "sy_nominal_ac_voltage",
          "par": "Nominal AC Voltage",
          "val": "230",
          "unit": "V"
        },
        {
          "id": "sy_battery_piece",
          "par": "Battery Piece",
          "val": "48V(5KW)"
        },
        {
          "id": "sy_machine_type",
          "par": "Machine Type",
          "val": "N/A"
        }
      ],
      "pv_": [
        {
          "id": "pv_status",
          "par": "PV Status",
          "val": "PV Undervoltage"
        },
        {
          "id": "pv_output_power",
          "par": "PV Input Power",
          "val": "0",
          "unit": "W"
        },
        {
          "id": "pv_input_voltage",
          "par": "PV Input Voltage",
          "val": "0.0",
          "unit": "V"
        }
      ],
      "bt_": [
        {
          "id": "bt_utility_charge",
          "par": "Max Utility Charge Current",
          "val": "20",
          "unit": "A"
        },
        {
          "id": "bt_battery_equalization_voltage",
          "par": "Battery Equalization Voltage",
          "val": "58.4",
          "unit": "V"
        },
        {
          "id": "bt_battery_charging_current",
          "par": "Battery Charging Current",
          "val": "0",
          "unit": "A"
        },
        {
          "id": "bt_vulk_charging_voltage",
          "par": "Bulk Charging Voltage",
          "val": "58.4",
          "unit": "V"
        },
        {
          "id": "bt_battery_equalization_interval",
          "par": "Battery Equalization Interval",
          "val": "30",
          "unit": "day"
        },
        {
          "id": "bt_battery_type",
          "par": "Battery Type",
          "val": "User"
        },
        {
          "id": "bt_battery_status",
          "par": "Battery Status",
          "val": "Charging Batteries"
        },
        {
          "id": "bt_battery_equalized_time",
          "par": "Battery Equalized Time",
          "val": "60",
          "unit": "min"
        },
        {
          "id": "bt_comeback_utility_iode",
          "par": "Comeback Utility Mode Voltage Point Under (SBU Priority)",
          "val": "48.0",
          "unit": "V"
        },
        {
          "id": "bt_battery_capacity",
          "par": "Battery Capacity",
          "val": "100",
          "unit": "%"
        },
        {
          "id": "bt_battery_discharge_current",
          "par": "Battery Discharge Current",
          "val": "0",
          "unit": "A"
        },
        {
          "id": "bt_floating_charging_voltage",
          "par": "Floating Charging Voltage",
          "val": "54.4",
          "unit": "V"
        },
        {
          "id": "bt_battery_voltage",
          "par": "Battery Voltage",
          "val": "54.4",
          "unit": "V"
        },
        {
          "id": "bt_battery_mode_voltage",
          "par": "Comeback Battery Mode Voltage Point Under (SBU Priority)",
          "val": "54.0",
          "unit": "V"
        },
        {
          "id": "bt_battery_equalized_timeout",
          "par": "Battery Equalized Timeout",
          "val": "120",
          "unit": "min"
        },
        {
          "id": "bt_battery_cut_off_voltage",
          "par": "Low Battery Cut-off Voltage",
          "val": "43.2",
          "unit": "V"
        },
        {
          "id": "bt_total_charge_current",
          "par": "Max Total Charge Current",
          "val": "60",
          "unit": "A"
        },
        {
          "id": "bt_charger_source_priority",
          "par": "Charger Source Priority",
          "val": "Solar and mains"
        }
      ],
      "bc_": [
        {
          "id": "bc_output_apparent_power",
          "par": "Output Apparent Power",
          "val": "294",
          "unit": "VA"
        },
        {
          "id": "bc_output_voltage",
          "par": "Output Voltage",
          "val": "226.8",
          "unit": "V"
        },
        {
          "id": "bc_load_status",
          "par": "Load Status",
          "val": "Load On (Normal)"
        },
        {
          "id": "bc_output_frequency",
          "par": "Output Frequency",
          "val": "49.9",
          "unit": "Hz"
        },
        {
          "id": "bc_output_source_priority",
          "par": "Output Source Priority",
          "val": "Solar"
        },
        {
          "id": "bc_battery_capacity",
          "par": "AC Output Load",
          "val": "4",
          "unit": "%"
        }
      ]
    }
  },
  "queryDeviceParsEs": {
    "parameter": [
      {
        "par": "bt_battery_charging_current",
        "name": "Battery Charging Current",
        "val": "0.0000",
        "unit": "A"
      },
      {
        "par": "bt_battery_discharge_current",
        "name": "Battery Discharge Current",
        "val": "0.0000",
        "unit": "A"
      },
      {
        "par": "bt_battery_voltage",
        "name": "Battery Voltage",
        "val": "54.4000",
        "unit": "V"
      },
      {
        "par": "bt_total_charge_current",
        "name": "Max Total Charge Current",
        "val": "60.0000",
        "unit": "A"
      },
      {
        "par": "output_power",
        "name": "Output Active Power",
        "val": "0.2490",
        "unit": "kW"
      },
      {
        "par": "pv_input_voltage",
        "name": "PV Input Voltage",
        "val": "0.0000",
        "unit": "V"
      },
      {
        "par": "pv_output_power",
        "name": "PV Input Power",
        "val": "0.0000",
        "unit": "kW"
      }
    ]
  }
}
```

[//]: # ()

[//]: # (Example data for devcode 2341 & address 5 &#40;or else&#41;)
