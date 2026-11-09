import { useQuery } from "@apollo/client";
import { createFileRoute, Link } from "@tanstack/react-router";
import { graphql } from "@/__generated__/index.js";
import { EmptyState } from "@/components/empty-state";
import { List } from "@/components/list";
import { ListItem } from "@/components/list-item";
import { LoadState } from "@/components/load-state";
import { PageLayout } from "@/components/page-layout";
import { Section } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "@/components/ui/icons";
import { asQuery } from "@/lib/as-query";

export const Route = createFileRoute("/groups/$groupId")({
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

function formatWindow(startsAt: string, endsAt: string): string {
  return `${new Date(startsAt).toLocaleString()} – ${new Date(endsAt).toLocaleString()}`;
}

function GroupPage() {
  const { groupId } = Route.useParams();
  const result = useQuery(GROUP_DETAIL, { variables: { id: groupId } });
  const group = result.data?.group;

  return (
    <PageLayout
      title={group?.name ?? "Group"}
      description={group ? `Overlap threshold: ${group.overlapThreshold}%` : undefined}
      loading={result.loading}
      width="prose"
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
            actionSlot={
              <Button
                variant="outline"
                linkSlot={<Link to="/groups" />}
                content="Back to your groups"
              />
            }
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
                        meta={
                          m.userId === group.ownerId ? (
                            <Badge variant="outline">Owner</Badge>
                          ) : undefined
                        }
                      />
                    ))}
                  />
                }
              />

              <Section
                title="Free Time Blocks"
                contentSlot={
                  group.timeBlocks.length === 0 ? (
                    <EmptyState compact title="No time blocks submitted yet." />
                  ) : (
                    <List
                      label="Free time blocks"
                      contentSlot={group.timeBlocks.map((tb) => (
                        <ListItem
                          key={tb.id}
                          title={tb.user.name ?? tb.user.email}
                          description={formatWindow(tb.startsAt, tb.endsAt)}
                        />
                      ))}
                    />
                  )
                }
              />

              {group.activeVote && (
                <Section
                  title="Active Vote"
                  description={`${group.activeVote.isForced ? "Forced vote" : "Regular vote"} · ${group.activeVote.slots.length} candidate slots`}
                  contentSlot={
                    <List
                      label="Candidate slots"
                      contentSlot={group.activeVote.slots.map((slot) => (
                        <ListItem
                          key={slot.id}
                          title={formatWindow(slot.startsAt, slot.endsAt)}
                          meta={`${slot.overlapCount} free`}
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
