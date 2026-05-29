import type { DB } from "@ravocal/db";
import type { Request } from "express";
import { jwtVerify } from "jose";

export type Context = {
  userId: string | null;
  db: DB;
};

const PUBLIC_MUTATIONS = new Set([
  "requestMagicLink",
  "verifyMagicLink",
  "acceptGroupInvite",
]);

export { PUBLIC_MUTATIONS };

export async function createContext(req: Request, db: DB): Promise<Context> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return { userId: null, db };

  const token = auth.slice(7);
  const secret = new TextEncoder().encode(
    process.env.JWT_SECRET ?? "dev-secret-change-in-production",
  );

  try {
    const { payload } = await jwtVerify(token, secret);
    return { userId: payload.sub as string, db };
  } catch {
    return { userId: null, db };
  }
}
