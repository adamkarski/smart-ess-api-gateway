import { config } from 'dotenv-flow';

const env = config().parsed;
export const appConfig = {
  dess: {
    auth: {
      username: env.DESS_AUTH_USERNAME,
      password: env.DESS_AUTH_PASSWORD || null,
      passwordHash: env.DESS_AUTH_PASSWORD_HASH || null,
    },
    device: {
      pn: env.DESS_DEVICE_PN,
      sn: env.DESS_DEVICE_SN,
      devcode: env.DESS_DEVICE_DEVCODE,
      devaddress: env.DESS_DEVICE_DEVADDR,
      batteryVoltage: Number(env.DEVICE_BATTERY_VOLTAGE ?? '48'),
    },
  },
  tuya: {
    apiKey: env.TUYA_API_KEY || '',
    apiSecret: env.TUYA_API_SECRET || '',
    region: env.TUYA_REGION || 'eu',
  },
};
