import type { DB } from '@cubicecho/ravocal-db';
import type { Request } from 'express';
import { jwtVerify } from 'jose';
import { jwtSecret } from './core/config.ts';

/** How a session token is sent: `Authorization: Bearer <jwt>`. */
const BEARER_PREFIX = 'Bearer ';

export type Context = {
  userId: string | null;
  db: DB;
};

const PUBLIC_MUTATIONS = new Set(['requestMagicLink', 'verifyMagicLink', 'acceptGroupInvite']);

export { PUBLIC_MUTATIONS };

export async function createContext(req: Request, db: DB): Promise<Context> {
  const auth = req.headers.authorization;
  const hasBearer = auth?.startsWith(BEARER_PREFIX) === true;
  if (hasBearer === false) {
    return { userId: null, db };
  }

  const token = auth.slice(BEARER_PREFIX.length);
  const secret = new TextEncoder().encode(jwtSecret());

  try {
    const { payload } = await jwtVerify(token, secret);
    return { userId: payload.sub as string, db };
  } catch {
    return { userId: null, db };
  }
}
