import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.ts';

/**
 * Drizzle v2 relations: what `db.query` can load with `with`.
 *
 * @remarks
 * A `one` side whose foreign key is not null is `optional: false`, so a loaded row's parent is typed as present.
 */
export const relations = defineRelations(schema, (relate) => ({
  users: {
    magicLinks: relate.many.magicLinks(),
    groupMemberships: relate.many.groupMembers(),
    ownedGroups: relate.many.groups(),
    timeBlocks: relate.many.timeBlocks(),
    voteRankings: relate.many.voteRankings(),
  },
  magicLinks: {
    user: relate.one.users({ from: relate.magicLinks.userId, to: relate.users.id, optional: false }),
  },
  groups: {
    owner: relate.one.users({ from: relate.groups.ownerId, to: relate.users.id, optional: false }),
    members: relate.many.groupMembers(),
    invites: relate.many.groupInvites(),
    timeBlocks: relate.many.timeBlocks(),
    votes: relate.many.votes(),
  },
  groupMembers: {
    group: relate.one.groups({ from: relate.groupMembers.groupId, to: relate.groups.id, optional: false }),
    user: relate.one.users({ from: relate.groupMembers.userId, to: relate.users.id, optional: false }),
  },
  groupInvites: {
    group: relate.one.groups({ from: relate.groupInvites.groupId, to: relate.groups.id, optional: false }),
  },
  timeBlocks: {
    group: relate.one.groups({ from: relate.timeBlocks.groupId, to: relate.groups.id, optional: false }),
    user: relate.one.users({ from: relate.timeBlocks.userId, to: relate.users.id, optional: false }),
  },
  votes: {
    group: relate.one.groups({ from: relate.votes.groupId, to: relate.groups.id, optional: false }),
    slots: relate.many.voteSlots(),
    rankings: relate.many.voteRankings(),
  },
  voteSlots: {
    vote: relate.one.votes({ from: relate.voteSlots.voteId, to: relate.votes.id, optional: false }),
    rankings: relate.many.voteRankings(),
  },
  voteRankings: {
    vote: relate.one.votes({ from: relate.voteRankings.voteId, to: relate.votes.id, optional: false }),
    slot: relate.one.voteSlots({ from: relate.voteRankings.slotId, to: relate.voteSlots.id, optional: false }),
    user: relate.one.users({ from: relate.voteRankings.userId, to: relate.users.id, optional: false }),
  },
}));
