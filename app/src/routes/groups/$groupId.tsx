import { useMutation, useQuery } from '@apollo/client';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { graphql } from '@/__generated__/index.js';
import { ConfirmButton } from '@/components/confirm-button';
import { UserPlus } from '@/components/domain/app-icons';
import { FreeTimeSection } from '@/components/domain/group/free-time-section';
import { GroupSettingsDialog } from '@/components/domain/group/group-settings-dialog';
import { InviteDialog } from '@/components/domain/group/invite-dialog';
import { VoteSection } from '@/components/domain/group/vote-section';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { LoadState } from '@/components/load-state';
import { PageLayout } from '@/components/page-layout';
import { Section } from '@/components/section';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Settings } from '@/components/ui/icons';
import { asQuery } from '@/lib/as-query';
import { describeError } from '@/lib/error-message';
import { formatDay } from '@/lib/time-window';
import { useDialog } from '@/lib/use-dialog';

export const Route = createFileRoute('/groups/$groupId')({
  component: GroupPage,
});

// `group` answers null to a reader who is not a member, which the page shows as "Group not found". Invites come
// back for the owner alone, and each vote's rankings are the reader's own ballot.
const GROUP_DETAIL = graphql(`
  query GroupDetail($id: UUID!) {
    getSession {
      user {
        id
      }
    }
    group(where: { id: { eq: $id } }) {
      id
      name
      ownerId
      overlapThreshold
      members {
        id
        userId
        user {
          id
          email
          name
        }
        joinedAt
      }
      invites(where: { acceptedAt: { isNull: true } }) {
        id
        email
        expiresAt
      }
      # Every block, not the first page of 50. Each list is priced by its page size, so a block's owner is looked up
      # in members rather than read again for every block.
      timeBlocks(limit: 500) {
        id
        userId
        startsAt
        endsAt
      }
      # The newest vote: the open one, or the last one's result. Every candidate, in ballot order.
      votes(limit: 1) {
        id
        status
        isForced
        slots(limit: 500) {
          id
          startsAt
          endsAt
          overlapCount
        }
        # The reader's ballot, which can rank every candidate.
        rankings(limit: 500) {
          id
          slotId
          rank
        }
        winnerSlotId
        closedAt
      }
    }
  }
`);

const REMOVE_MEMBER = graphql(`
  mutation RemoveMember($groupId: UUID!, $userId: UUID!) {
    removeMember(groupId: $groupId, userId: $userId) {
      id
    }
  }
`);

const CANCEL_INVITE = graphql(`
  mutation CancelInvite($id: UUID!) {
    cancelInvite(id: $id) {
      id
    }
  }
`);

function GroupPage() {
  const { groupId } = Route.useParams();
  const result = useQuery(GROUP_DETAIL, { variables: { id: groupId } });
  const group = result.data?.group;
  const readerId = result.data?.getSession?.user.id;
  const isOwner = group !== undefined && group !== null && readerId === group.ownerId;
  const inviteDialog = useDialog();
  const settingsDialog = useDialog();
  // The address the last invite went to, said once above the list it joined.
  const [invited, setInvited] = useState<string | null>(null);

  // Removing a member takes their free time and ballot with them, so the whole page is read again.
  const refetch = { refetchQueries: [GROUP_DETAIL], awaitRefetchQueries: true };
  const [removeMember, removing] = useMutation(REMOVE_MEMBER, { ...refetch, onError: () => {} });
  const [cancelInvite, cancelling] = useMutation(CANCEL_INVITE, { ...refetch, onError: () => {} });
  const failure = removing.error ?? cancelling.error;

  return (
    <PageLayout
      title={group?.name ?? 'Group'}
      description={group ? `Overlap threshold: ${group.overlapThreshold}%` : undefined}
      loading={result.loading}
      width="prose"
      // A section's heading sits gap-6 over its rows, so the sections need more room than that
      // between them, or each heading reads as the end of the list above it.
      contentClassName="gap-10"
      actionSlot={
        isOwner ? (
          <>
            <Button
              size="sm"
              variant="outline"
              iconSlot={<Settings />}
              onClick={settingsDialog.show}
              content="Settings"
            />
            <Button size="sm" variant="info" iconSlot={<UserPlus />} onClick={inviteDialog.show} content="Invite" />
          </>
        ) : undefined
      }
      backSlot={
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Back to your groups"
          iconSlot={<ArrowLeft />}
          linkSlot={<Link to="/groups" />}
        />
      }
      contentSlot={
        <>
          <LoadState
            query={asQuery(result)}
            what="this group"
            record={group}
            notFoundLabel="Group not found"
            description="You may not be a member, or the link is old."
            actionSlot={<Button variant="outline" linkSlot={<Link to="/groups" />} content="Back to your groups" />}
            level={2}
          />
          {failure ? (
            <Alert variant="destructive" title="That didn't work" description={describeError(failure)} />
          ) : null}
          {invited ? (
            <Alert
              variant="info"
              title={`Invite sent to ${invited}`}
              description="They're listed under Invited until they open the link."
              actionSlot={<Button size="sm" variant="ghost" onClick={() => setInvited(null)} content="Dismiss" />}
            />
          ) : null}
          {group ? (
            <>
              <VoteSection group={group} isOwner={isOwner} />

              <FreeTimeSection group={group} readerId={readerId} />

              <Section
                title={`Members (${group.members.length})`}
                contentSlot={
                  <List
                    label="Members"
                    contentSlot={group.members.map((m) => {
                      const name = m.user.name || m.user.email;
                      const isGroupOwner = m.userId === group.ownerId;
                      return (
                        <ListItem
                          key={m.id}
                          title={name}
                          description={m.user.name ? m.user.email : undefined}
                          meta={isGroupOwner ? <Badge variant="outline">Owner</Badge> : undefined}
                          actionSlot={
                            isOwner && isGroupOwner === false ? (
                              <ConfirmButton
                                size="sm"
                                loading={removing.loading}
                                title={`Remove ${name}?`}
                                description="They lose the group, and their free time in it and their ballot in the open vote go with them. A closed vote's result stays."
                                confirmLabel="Remove"
                                onConfirm={() =>
                                  void removeMember({ variables: { groupId: group.id, userId: m.userId } })
                                }
                                content="Remove"
                              />
                            ) : undefined
                          }
                        />
                      );
                    })}
                  />
                }
              />

              {group.invites.length > 0 && (
                <Section
                  title={`Invited (${group.invites.length})`}
                  description="Whoever opens an invite's link while signed in joins, once."
                  contentSlot={
                    <List
                      label="Invited"
                      contentSlot={group.invites.map((invite) => (
                        <ListItem
                          key={invite.id}
                          title={invite.email}
                          meta={`Expires ${formatDay(invite.expiresAt)}`}
                          actionSlot={
                            isOwner ? (
                              <ConfirmButton
                                size="sm"
                                loading={cancelling.loading}
                                title={`Cancel the invite to ${invite.email}?`}
                                description="Its link stops working, so nobody can join with it. You can invite them again."
                                confirmLabel="Cancel invite"
                                cancelLabel="Keep it"
                                onConfirm={() => void cancelInvite({ variables: { id: invite.id } })}
                                content="Cancel invite"
                              />
                            ) : undefined
                          }
                        />
                      ))}
                    />
                  }
                />
              )}

              {isOwner ? (
                <>
                  <InviteDialog
                    key={`invite-${inviteDialog.key}`}
                    groupId={group.id}
                    open={inviteDialog.open}
                    onOpenChange={inviteDialog.onOpenChange}
                    onInvited={setInvited}
                  />
                  <GroupSettingsDialog
                    key={`settings-${settingsDialog.key}`}
                    group={group}
                    open={settingsDialog.open}
                    onOpenChange={settingsDialog.onOpenChange}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </>
      }
    />
  );
}
