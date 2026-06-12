import { server } from './server';
import { registerAuthRoutes } from './auth';
import { fetchSolarForecast } from '../automation/nodes/weather.node';
import * as dess from '../lib/dess/dess';
import {
  queryDeviceList,
  resolveTargetOptions,
  setDeviceParsEs,
  TargetOptions,
} from '../lib/dess/dess';
import { ResponseDessHttpSettings } from './responses';
import {
  QUERY_DEVICE_CONTROL_ID,
  QueryDeviceStatus,
} from '../lib/dess/dess-api.types';
import {
  authRenewCheck,
  formatAuthData,
  performAuth,
} from '../actions/auth-service';
import { register } from '../metrics/prom';
import { controllerGetData } from './controllers/query-data.controller';
import { transferUriStr } from '../lib/utils';
import { appConfig } from '../config';
import { automationController } from './controllers/automation.controller';
import { registerBMSRoutes } from './controllers/bms.controller';
import { getHourly, getAvailableDays, recalculateStats } from '../stats/daily-stats';
import { automationState } from '../automation/state';

registerAuthRoutes();
automationController(server);
registerBMSRoutes();

server.get('/auth', async function handler(request, reply) {
  const auth =
    request.query['force'] === 'true'
      ? await performAuth()
      : await authRenewCheck();
  reply.send({
    auth,
  });
});

server.get('/settings/device', async function handler(request, reply) {
  const saved = automationState.settings.dess || {} as any;
  reply.send({
    pn: saved.pn || appConfig.dess.device.pn,
    sn: saved.sn || appConfig.dess.device.sn,
    devcode: saved.devcode || appConfig.dess.device.devcode,
    devaddr: saved.devaddr || appConfig.dess.device.devaddress,
    batteryVoltage: saved.batteryVoltage || appConfig.dess.device.batteryVoltage,
    username: saved.username || appConfig.dess.auth.username,
  });
});

server.get('/devices', async function handler(request, reply) {
  const auth = formatAuthData(await authRenewCheck());
  const response = await queryDeviceList(auth, {
    status: request.query['status'],
  });
  reply.send(response.device);
});

server.get('/data', async function handler(request, reply) {
  const payload = await controllerGetData(request.query);

  reply.send(payload);
});

server.get('/settings', async function handler(request, reply) {
  try {
    const auth = formatAuthData(await authRenewCheck());
    const target: TargetOptions = resolveTargetOptions({
      pn: request.query['pn'],
      sn: request.query['sn'],
      devcode: request.query['devcode'],
      devaddr: request.query['devaddr'],
    });
    
    // 1. Try fetching via known IDs
    const idsToTry = [
      'bse_output_source_priority_read', 'los_output_source_priority', 'bse_output_source_priority',
      'bat_max_charging_current_read', 'bat_max_charging_current',
      'bat_ac_charging_current_read', 'bat_max_utility_charge_current', 'bat_ac_charging_current',
      'bat_charger_source_priority_read', 'bat_charger_source_priority'
    ];

    const settingsPromises = idsToTry.map(async (id) => {
      try {
        return await dess.queryDeviceCtrlValue(auth, id as any, target);
      } catch (e) { return null; }
    });

    const results = (await Promise.all(settingsPromises)).filter(s => s !== null && !((s as any).err));
    
    // 2. Always include data from /data as fallback
    const deviceData = await controllerGetData(request.query as any);
    
    reply.send({ 
      settings: results,
      fallbackData: deviceData.querySPDeviceLastData?.pars || {},
      devicePars: deviceData.queryDeviceParsEs?.dat?.parameter || []
    });
  } catch (error) {
    console.error('Settings fetch error:', error);
    reply.status(500).send({ error: 'Failed to fetch settings', details: error.message });
  }
});

server.get('/settings-refresh', async function handler(request, reply) {
  // Just a proxy to the robust /settings for this device
  return reply.redirect('/settings?' + transferUriStr(request.query as any));
});

server.get('/settings-set', async function handler(request, reply) {
  const auth = formatAuthData(await authRenewCheck());
  const target: TargetOptions = resolveTargetOptions({
    pn: request.query['pn'],
    sn: request.query['sn'],
    devcode: request.query['devcode'],
    devaddr: request.query['devaddr'],
  });
  const payload = await setDeviceParsEs(
    auth,
    request.query['id'] as any,
    request.query['value'] as any,
    target,
  );
  reply.send(payload);
});

server.get('/stats/daily', async function handler(request, reply) {
  const date = (request.query as any).date || new Intl.DateTimeFormat('en-CA').format(new Date());
  const data = getHourly(date);
  const tariff = (automationState.settings as any).tariff;
  const tInfo = {
    offpeakRanges: tariff?.offpeakRanges || [],
    source: tariff?.source || 'static'
  };

  if (!data) {
    return reply.send({ date, hours: [], totals: {}, availableDays: getAvailableDays(), tariff: tInfo });
  }
  reply.send({ ...data, availableDays: getAvailableDays(), tariff: tInfo });
});

server.post('/stats/recalculate', async function handler(request, reply) {
  const batteryKwh = parseFloat((request.body as any)?.batteryKwh) || 16;
  const result = recalculateStats(batteryKwh);
  reply.send(result);
});

server.get('/api/poll', async function handler(request, reply) {
  const [dessData, todayStats] = await Promise.all([
    controllerGetData(request.query).catch(() => null),
    (async () => {
      const { getHourly, getAvailableDays } = await import('../stats/daily-stats');
      const date = new Intl.DateTimeFormat('en-CA').format(new Date());
      const data = getHourly(date);
      return data ? { ...data, availableDays: getAvailableDays() } : { date, hours: [], totals: {}, availableDays: getAvailableDays() };
    })(),
  ]);
  const displays: Record<string, { lastVal?: string; lastUpdate?: number }> = {};
  for (const [id, node] of Object.entries(automationState.nodes)) {
    if (node.lastVal !== undefined || node.lastUpdate) {
      displays[id] = { lastVal: node.lastVal, lastUpdate: node.lastUpdate };
    }
  }
  const predictorNodes = Object.values(automationState.nodes).filter(n => n.type === 'predictor');
  const predictorData = predictorNodes.length > 0 ? predictorNodes[0].data : {};

  reply.send({
    data: dessData,
    stats: todayStats,
    displays,
    predictor: predictorData,
    tick: automationState._tick || 0,
  });
});

server.get('/api/solar/predict', async function handler(request, reply) {
  const solar = automationState.settings.solar;
  const settings = automationState.settings;
  const weather = settings.weather as any || {};
  const lat = (request.query as any).lat || weather.lat;
  const lon = (request.query as any).lon || weather.lon;
  const kwp = parseFloat((request.query as any).kwp) || solar?.kwp || 0;
  const tilt = parseFloat((request.query as any).tilt) ?? solar?.tilt ?? 0;
  const azimuth = parseFloat((request.query as any).azimuth) ?? solar?.azimuth ?? 0;
  if (!lat || !lon || !kwp) {
    return reply.status(400).send({ error: 'Missing lat, lon, or kwp' });
  }
  try {
    const result = await fetchSolarForecast(String(lat), String(lon), kwp, tilt, azimuth);
    reply.send(result);
  } catch (e: any) {
    reply.status(500).send({ error: e.message });
  }
});

server.get('/metrics', async function handler(request, reply) {
  const auth = formatAuthData(await authRenewCheck());
  const response = await queryDeviceList(auth, {
    status: request.query['status'],
  });
  for (const item of response.device) {
    if (item.status !== QueryDeviceStatus.OFFLINE) {
      await controllerGetData({
        devaddr: item.devaddr.toString(),
        devcode: item.devcode.toString(),
        sn: item.sn,
        pn: item.pn,
        name: item.devalias,
      });
    }
  }
  reply.send(await register.metrics());
});

server.post('/api/restart', async function handler(request, reply) {
  reply.send({ ok: true, message: 'Restarting...' });
  setTimeout(() => process.exit(0), 500);
});
