import type { Context } from "../../context.ts";
import { requestMagicLink, verifyMagicLink } from "../../services/auth.ts";

export function applyAuthResolvers(
  _queryFields: Record<string, unknown>,
  mutationFields: Record<string, unknown>,
) {
  mutationFields.requestMagicLink = async (
    _: unknown,
    args: { email: string },
    ctx: Context,
  ) => {
    await requestMagicLink(args.email, ctx.db);
    return true;
  };

  mutationFields.verifyMagicLink = async (
    _: unknown,
    args: { token: string },
    ctx: Context,
  ) => {
    return verifyMagicLink(args.token, ctx.db);
  };
}
