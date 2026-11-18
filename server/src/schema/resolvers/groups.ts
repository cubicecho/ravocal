import { groupInvites, groupMembers, groups, users } from '@cubicecho/ravocal-db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from '../../context.ts';
import { GROUP_DEFAULTS } from '../../core/defaults.ts';
import { MS_PER_DAY, PERCENT } from '../../core/wire.ts';
import { randomToken } from '../../services/auth.ts';
import { sendGroupInviteEmail } from '../../services/email.ts';

const nameSchema = z.string().min(1).max(GROUP_DEFAULTS.maxNameLength);
const overlapThresholdSchema = z.number().int().min(0).max(PERCENT);

// Left out, overlapThreshold takes the column's default.
const CreateGroupInput = z.object({
  name: nameSchema,
  overlapThreshold: overlapThresholdSchema.optional(),
});

const UpdateGroupInput = z.object({
  name: nameSchema.optional(),
  overlapThreshold: overlapThresholdSchema.optional(),
});

/** Everything a `Group` resolves to, loaded in one relational query. */
const GROUP_WITH = {
  owner: true,
  members: { with: { user: true } },
  invites: true,
  timeBlocks: { with: { user: true } },
  // A vote's slots and the viewer's rankings come from the Vote field resolvers (votes.ts).
  votes: true,
} as const;

/** What `shapeGroup` reads off a group loaded with `GROUP_WITH`. */
interface LoadedGroup {
  invites: Array<{ acceptedAt: Date | null }>;
  votes: Array<{ status: string }>;
}

/** A group loaded with `GROUP_WITH`, in the `Group` type's shape. */
function shapeGroup<G extends LoadedGroup>(group: G) {
  return {
    ...group,
    pendingInvites: group.invites.filter((i) => !i.acceptedAt),
    activeVote: group.votes.find((v) => v.status === 'active') ?? null,
  };
}

export function applyGroupResolvers(queryFields: Record<string, unknown>, mutationFields: Record<string, unknown>) {
  queryFields.me = async (_: unknown, __: unknown, ctx: Context) => {
    if (!ctx.userId) {
      return null;
    }
    return ctx.db.query.users.findFirst({ where: { id: ctx.userId } });
  };

  queryFields.myGroups = async (_: unknown, __: unknown, ctx: Context) => {
    const userId = ctx.userId;
    if (!userId) {
      throw new Error('Not authenticated');
    }
    const memberships = await ctx.db.query.groupMembers.findMany({
      where: { userId },
      with: { group: { with: GROUP_WITH } },
    });
    return memberships.map((m) => shapeGroup(m.group));
  };

  queryFields.group = async (_: unknown, args: { id: string }, ctx: Context) => {
    if (!ctx.userId) {
      throw new Error('Not authenticated');
    }
    const group = await ctx.db.query.groups.findFirst({
      where: { id: args.id },
      with: GROUP_WITH,
    });
    if (!group) {
      throw new Error(`Group ${args.id} not found`);
    }
    const isMember = group.members.some((m) => m.userId === ctx.userId);
    if (isMember === false) {
      throw new Error('Forbidden');
    }
    return shapeGroup(group);
  };

  mutationFields.updateMyProfile = async (_: unknown, args: { name: string }, ctx: Context) => {
    if (!ctx.userId) {
      throw new Error('Not authenticated');
    }
    const [updated] = await ctx.db.update(users).set({ name: args.name }).where(eq(users.id, ctx.userId)).returning();
    return updated;
  };

  mutationFields.createGroup = async (_: unknown, args: { name: string; overlapThreshold?: number }, ctx: Context) => {
    if (!ctx.userId) {
      throw new Error('Not authenticated');
    }
    const input = CreateGroupInput.parse(args);
    const [group] = await ctx.db
      .insert(groups)
      .values({ ...input, ownerId: ctx.userId })
      .returning();
    await ctx.db.insert(groupMembers).values({ groupId: group.id, userId: ctx.userId });
    return group;
  };

  mutationFields.updateGroup = async (
    _: unknown,
    args: { id: string; name?: string; overlapThreshold?: number },
    ctx: Context,
  ) => {
    if (!ctx.userId) {
      throw new Error('Not authenticated');
    }
    const group = await ctx.db.query.groups.findFirst({ where: { id: args.id } });
    if (!group) {
      throw new Error(`Group ${args.id} not found`);
    }
    if (group.ownerId !== ctx.userId) {
      throw new Error('Forbidden');
    }
    const input = UpdateGroupInput.parse({
      name: args.name,
      overlapThreshold: args.overlapThreshold,
    });
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const [updated] = await ctx.db.update(groups).set(patch).where(eq(groups.id, args.id)).returning();
    return updated;
  };

  mutationFields.deleteGroup = async (_: unknown, args: { id: string }, ctx: Context) => {
    if (!ctx.userId) {
      throw new Error('Not authenticated');
    }
    const group = await ctx.db.query.groups.findFirst({ where: { id: args.id } });
    if (!group) {
      throw new Error(`Group ${args.id} not found`);
    }
    if (group.ownerId !== ctx.userId) {
      throw new Error('Forbidden');
    }
    await ctx.db.delete(groups).where(eq(groups.id, args.id));
    return true;
  };

  mutationFields.inviteToGroup = async (_: unknown, args: { groupId: string; email: string }, ctx: Context) => {
    if (!ctx.userId) {
      throw new Error('Not authenticated');
    }
    const group = await ctx.db.query.groups.findFirst({
      where: { id: args.groupId },
    });
    if (!group) {
      throw new Error(`Group ${args.groupId} not found`);
    }
    if (group.ownerId !== ctx.userId) {
      throw new Error('Forbidden');
    }

    const token = randomToken();
    const expiresAt = new Date(Date.now() + GROUP_DEFAULTS.inviteTtlDays * MS_PER_DAY);
    const [invite] = await ctx.db
      .insert(groupInvites)
      .values({ groupId: args.groupId, email: args.email, token, expiresAt })
      .returning();

    await sendGroupInviteEmail(args.email, group.name, token);
    return invite;
  };

  mutationFields.acceptGroupInvite = async (_: unknown, args: { token: string }, ctx: Context) => {
    if (!ctx.userId) {
      throw new Error('Not authenticated');
    }
    const invite = await ctx.db.query.groupInvites.findFirst({
      where: { token: args.token },
    });
    if (!invite) {
      throw new Error('Invite not found');
    }
    if (invite.acceptedAt) {
      throw new Error('Invite already accepted');
    }
    if (invite.expiresAt < new Date()) {
      throw new Error('Invite expired');
    }

    await ctx.db.update(groupInvites).set({ acceptedAt: new Date() }).where(eq(groupInvites.id, invite.id));
    const [member] = await ctx.db
      .insert(groupMembers)
      .values({ groupId: invite.groupId, userId: ctx.userId })
      .returning();
    return member;
  };
}
