import * as dess from '../lib/dess/dess';
import { appConfig } from '../config';
import { state } from '../state';
import { DessAuthResponseData } from '../lib/dess/dess-api.types';

const AUTH_EDGE_DIFF = 60 * 60 * 1000;

export async function performAuth(authData?: {
  username: string;
  plainPassword?: string;
  hashPassword?: string;
}) {
  const username = authData?.username ?? appConfig.dess.auth.username;
  if (!username) {
    throw new Error('AuthError: no username provided');
  }
  console.log(`performAuth for ${username}`);
  const exist = state.authMap.get(username);
  if (exist) {
    const diff = new Date().getTime() - exist.issuedAt.getTime();
    if (exist.data.expire * 1000 - diff <= AUTH_EDGE_DIFF) {
      console.log(`exists auth renew for ${username}`);
    } else {
      console.log(`exists auth for ${username}`);
      return exist.data;
    }
  }
  const password =
    authData?.hashPassword ||
    authData?.plainPassword ||
    appConfig.dess.auth.passwordHash ||
    appConfig.dess.auth.password;
  const auth = await dess.authUser(
    username,
    password,
    !!authData?.hashPassword || !!appConfig.dess.auth?.passwordHash,
  );
  console.log('performAuth:success', auth.uid);
  state.authMap.set(username, {
    data: auth,
    issuedAt: new Date(),
  });
  if (!authData) {
    state.auth = auth;
    state.authIssued = new Date().getTime();
  }
  return auth;
}

export async function authRenewCheck() {
  if (state.authIssued === null) return performAuth();
  const diff = new Date().getTime() - state.authIssued;
  if (state.auth.expire * 1000 - diff <= AUTH_EDGE_DIFF) {
    console.log('authRenewCheck');
    return performAuth();
  }
  return state.auth;
}

export async function authWatchManager() {
  await performAuth();
  setInterval(() => {
    authRenewCheck().catch(err => console.error('[Auth] Renew failed:', (err as Error).message));
  }, 10_000);
}

export function formatAuthData(auth: DessAuthResponseData) {
  return {
    token: auth.token,
    secret: auth.secret,
  };
}
