import { useQuery } from '@apollo/client';
import { createFileRoute, Link } from '@tanstack/react-router';
import { graphql } from '@/__generated__/index.js';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { LoadState } from '@/components/load-state';
import { PageLayout } from '@/components/page-layout';
import { Section } from '@/components/section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from '@/components/ui/icons';
import { asQuery } from '@/lib/as-query';
import { byStart, formatDay, formatWindow } from '@/lib/time-window';

export const Route = createFileRoute('/groups/$groupId')({
  component: GroupPage,
});

const GROUP_DETAIL = graphql(`
  query GroupDetail($id: ID!) {
    group(id: $id) {
      id
      name
      ownerId
      overlapThreshold
      owner {
        id
        email
        name
      }
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
      pendingInvites {
        id
        email
        expiresAt
      }
      timeBlocks {
        id
        userId
        user {
          id
          name
          email
        }
        startsAt
        endsAt
      }
      activeVote {
        id
        status
        isForced
        slots {
          id
          startsAt
          endsAt
          overlapCount
        }
        myRankings {
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

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function GroupPage() {
  const { groupId } = Route.useParams();
  const result = useQuery(GROUP_DETAIL, { variables: { id: groupId } });
  const group = result.data?.group;
  const vote = group?.activeVote;

  return (
    <PageLayout
      title={group?.name ?? 'Group'}
      description={group ? `Overlap threshold: ${group.overlapThreshold}%` : undefined}
      loading={result.loading}
      width="prose"
      // A section's heading sits gap-6 over its rows, so the sections need more room than that
      // between them, or each heading reads as the end of the list above it.
      contentClassName="gap-10"
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
          {group ? (
            <>
              <Section
                title={`Members (${group.members.length})`}
                contentSlot={
                  <List
                    label="Members"
                    contentSlot={group.members.map((m) => (
                      <ListItem
                        key={m.id}
                        title={m.user.name ?? m.user.email}
                        description={m.user.name ? m.user.email : undefined}
                        meta={m.userId === group.ownerId ? <Badge variant="outline">Owner</Badge> : undefined}
                      />
                    ))}
                  />
                }
              />

              {group.pendingInvites.length > 0 && (
                <Section
                  title={`Invited (${group.pendingInvites.length})`}
                  description="They join once they open the link in their invite email."
                  contentSlot={
                    <List
                      label="Invited"
                      contentSlot={group.pendingInvites.map((invite) => (
                        <ListItem
                          key={invite.id}
                          title={invite.email}
                          meta={`Expires ${formatDay(invite.expiresAt)}`}
                        />
                      ))}
                    />
                  }
                />
              )}

              <Section
                title="Free time"
                contentSlot={
                  group.timeBlocks.length === 0 ? (
                    <EmptyState compact title="No one has added free time yet." />
                  ) : (
                    <List
                      label="Free time"
                      contentSlot={[...group.timeBlocks]
                        .sort(byStart)
                        .map((tb) => (
                          <ListItem
                            key={tb.id}
                            title={formatWindow(tb.startsAt, tb.endsAt)}
                            description={tb.user.name ?? tb.user.email}
                          />
                        ))}
                    />
                  )
                }
              />

              {vote && (
                <Section
                  title="Active vote"
                  description={`${vote.isForced ? 'Forced vote' : 'Vote'} over ${plural(vote.slots.length, 'candidate time', 'candidate times')}`}
                  contentSlot={
                    <List
                      label="Candidate times"
                      contentSlot={[...vote.slots]
                        .sort(byStart)
                        .map((slot) => (
                          <ListItem
                            key={slot.id}
                            title={formatWindow(slot.startsAt, slot.endsAt)}
                            meta={`${slot.overlapCount} of ${group.members.length} free`}
                          />
                        ))}
                    />
                  }
                />
              )}
            </>
          ) : null}
        </>
      }
    />
  );
}
