import { relations } from "drizzle-orm";
import {
  groupInvites,
  groupMembers,
  groups,
  magicLinks,
  timeBlocks,
  users,
  voteRankings,
  voteSlots,
  votes,
} from "./schema.ts";

export const usersRelations = relations(users, ({ many }) => ({
  magicLinks: many(magicLinks),
  groupMemberships: many(groupMembers),
  ownedGroups: many(groups),
  timeBlocks: many(timeBlocks),
  voteRankings: many(voteRankings),
}));

export const magicLinksRelations = relations(magicLinks, ({ one }) => ({
  user: one(users, { fields: [magicLinks.userId], references: [users.id] }),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  owner: one(users, { fields: [groups.ownerId], references: [users.id] }),
  members: many(groupMembers),
  invites: many(groupInvites),
  timeBlocks: many(timeBlocks),
  votes: many(votes),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, { fields: [groupMembers.groupId], references: [groups.id] }),
  user: one(users, { fields: [groupMembers.userId], references: [users.id] }),
}));

export const groupInvitesRelations = relations(groupInvites, ({ one }) => ({
  group: one(groups, { fields: [groupInvites.groupId], references: [groups.id] }),
}));

export const timeBlocksRelations = relations(timeBlocks, ({ one }) => ({
  group: one(groups, { fields: [timeBlocks.groupId], references: [groups.id] }),
  user: one(users, { fields: [timeBlocks.userId], references: [users.id] }),
}));

export const votesRelations = relations(votes, ({ one, many }) => ({
  group: one(groups, { fields: [votes.groupId], references: [groups.id] }),
  slots: many(voteSlots),
  rankings: many(voteRankings),
}));

export const voteSlotsRelations = relations(voteSlots, ({ one, many }) => ({
  vote: one(votes, { fields: [voteSlots.voteId], references: [votes.id] }),
  rankings: many(voteRankings),
}));

export const voteRankingsRelations = relations(voteRankings, ({ one }) => ({
  vote: one(votes, { fields: [voteRankings.voteId], references: [votes.id] }),
  slot: one(voteSlots, { fields: [voteRankings.slotId], references: [voteSlots.id] }),
  user: one(users, { fields: [voteRankings.userId], references: [users.id] }),
}));
