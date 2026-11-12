// Cookie management — get/set/delete cookies over CDP's Network domain.
//
// Cookies are domain-scoped; `setCookies` requires matching domain/path or
// they're silently dropped by Chrome. HttpOnly cookies can be read via
// Network.getCookies (CDP has full access) but NOT via Runtime.evaluate.

import type { CDPConnection } from './connection.js';
import { Network } from './types.js';
import type { Session } from './session.js';

type Conn = CDPConnection;

/** Get all cookies visible to the session's page. */
export async function getCookies(session: Session): Promise<Network.Cookie[]> {
  const conn = await session.page();
  await conn.send('Network.enable');
  const result = await conn.send<Network.GetCookiesResult>('Network.getCookies', {});
  return result.cookies ?? [];
}

/** Set cookies on the session's page. Cookies are domain-scoped. */
export async function setCookies(
  session: Session,
  cookies: Network.Cookie[],
): Promise<void> {
  const conn = await session.page();
  await conn.send('Network.enable');
  await conn.send('Network.setCookies', { cookies });
}

/** Delete cookies matching name + domain (+ optional path). */
export async function deleteCookies(
  session: Session,
  cookie: { name: string; domain: string; path?: string },
): Promise<void> {
  const conn = await session.page();
  await conn.send('Network.enable');
  await conn.send('Network.deleteCookies', {
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
  });
}
