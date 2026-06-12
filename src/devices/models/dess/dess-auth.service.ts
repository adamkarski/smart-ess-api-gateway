import { hashSha1, transferUriStr } from '../../../lib/utils';
import { DessAuthResponseData, DessAuthParams, DESS_QUERY_ACTION } from './dess-api.types';
import { appConfig } from '../../../config';

const COMPANY_KEY = 'bnrl_frRFjEz8Mkn';

let cachedAuth: {
  data: DessAuthResponseData;
  expiresAt: number;
} | null = null;

async function performAuth(username: string, password: string, hashedPassword = false): Promise<DessAuthResponseData> {
  const { default: axios } = await import('axios');
  const salt = new Date().getTime().toString();
  const pwdSha1 = hashedPassword ? password : hashSha1(password);
  const params = {
    action: DESS_QUERY_ACTION.AUTH_SOURCE,
    usr: username,
    source: '1',
    'company-key': COMPANY_KEY,
  };
  let uriStr = transferUriStr(params);
  let sign = hashSha1(`${salt}${pwdSha1}&${uriStr}`);
  const r = await axios.get('https://web.dessmonitor.com/public/', {
    params: { sign, salt, ...params },
  });
  if (r.data.err !== 0) throw r.data;
  return r.data.dat as DessAuthResponseData;
}

export async function ensureAuth(): Promise<DessAuthParams> {
  const now = Date.now();
  if (cachedAuth && cachedAuth.expiresAt > now) {
    return { token: cachedAuth.data.token, secret: cachedAuth.data.secret };
  }

  const cfg = appConfig.dess.auth;
  if (!cfg.username) throw new Error('DESS username not configured');

  const data = cfg.passwordHash
    ? await performAuth(cfg.username, cfg.passwordHash, true)
    : await performAuth(cfg.username, cfg.password!);

  cachedAuth = {
    data,
    expiresAt: (data.expire * 1000) - 3600000,
  };
  return { token: data.token, secret: data.secret };
}
