import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { type DB, magicLinks, users } from "@ravocal/db";
import { SignJWT } from "jose";
import { sendMagicLinkEmail } from "./email.ts";

export function randomToken(): string {
  return randomBytes(32).toString("hex");
}

export async function requestMagicLink(email: string, db: DB): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const appUrl = process.env.APP_URL ?? "http://localhost:3001";

  let user = await db.query.users.findFirst({ where: eq(users.email, normalizedEmail) });
  if (!user) {
    [user] = await db.insert(users).values({ email: normalizedEmail }).returning();
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await db.insert(magicLinks).values({ userId: user.id, token, expiresAt });

  const link = `${appUrl}/login/verify?token=${token}`;
  await sendMagicLinkEmail(normalizedEmail, link);
}

export async function verifyMagicLink(
  token: string,
  db: DB,
): Promise<{
  token: string;
  user: { id: string; email: string; name: string | null; createdAt: string };
}> {
  const link = await db.query.magicLinks.findFirst({
    where: eq(magicLinks.token, token),
    with: { user: true },
  });
  if (!link) throw new Error("Invalid or expired magic link");
  if (link.usedAt) throw new Error("Magic link already used");
  if (link.expiresAt < new Date()) throw new Error("Magic link expired");

  await db.update(magicLinks).set({ usedAt: new Date() }).where(eq(magicLinks.id, link.id));

  const secret = new TextEncoder().encode(
    process.env.JWT_SECRET ?? "dev-secret-change-in-production",
  );
  const jwt = await new SignJWT({ sub: link.user.id, email: link.user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);

  return {
    token: jwt,
    user: {
      ...link.user,
      createdAt: link.user.createdAt.toISOString(),
    },
  };
}
