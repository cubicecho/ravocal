import { useQuery } from "@apollo/client";
import { createFileRoute } from "@tanstack/react-router";
import { graphql } from "@/__generated__/index.js";

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

function GroupPage() {
  const { groupId } = Route.useParams();
  const { data, loading, error } = useQuery(GROUP_DETAIL, { variables: { id: groupId } });

  if (loading) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (error) return <p className="p-8 text-destructive">{error.message}</p>;

  const group = data?.group;
  if (!group) return <p className="p-8 text-muted-foreground">Group not found.</p>;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{group.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overlap threshold: {group.overlapThreshold}%
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Members ({group.members.length})</h2>
        <ul className="space-y-2">
          {group.members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-sm">
              <span>{m.user.name ?? m.user.email}</span>
              {m.userId === group.ownerId && (
                <span className="text-xs text-muted-foreground">(owner)</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Free Time Blocks</h2>
        {group.timeBlocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No time blocks submitted yet.</p>
        ) : (
          <ul className="space-y-2">
            {group.timeBlocks.map((tb) => (
              <li key={tb.id} className="text-sm rounded-md border border-border p-3">
                <span className="font-medium">{tb.user.name ?? tb.user.email}</span>
                <span className="text-muted-foreground ml-2">
                  {new Date(tb.startsAt).toLocaleString()} –{" "}
                  {new Date(tb.endsAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {group.activeVote && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Active Vote</h2>
          <div className="rounded-lg border border-border p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              {group.activeVote.isForced ? "Forced vote" : "Regular vote"} ·{" "}
              {group.activeVote.slots.length} candidate slots
            </p>
            <ul className="space-y-2">
              {group.activeVote.slots.map((slot) => (
                <li key={slot.id} className="text-sm flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <span>
                    {new Date(slot.startsAt).toLocaleString()} –{" "}
                    {new Date(slot.endsAt).toLocaleString()}
                  </span>
                  <span className="text-muted-foreground">
                    {slot.overlapCount} free
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
