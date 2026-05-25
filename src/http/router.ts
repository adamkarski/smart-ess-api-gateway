import { server } from './server';
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
import { automationController } from './controllers/automation.controller';

automationController(server);

server.get('/auth', async function handler(request, reply) {
  const auth =
    request.query['force'] === 'true'
      ? await performAuth()
      : await authRenewCheck();
  reply.send({
    auth,
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
    fallbackData: deviceData.querySPDeviceLastData.pars,
    devicePars: deviceData.queryDeviceParsEs.dat.parameter
  });
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
