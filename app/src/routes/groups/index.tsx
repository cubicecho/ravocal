import { useQuery } from "@apollo/client";
import { createFileRoute, Link } from "@tanstack/react-router";
import { graphql } from "@/__generated__/index.js";

export const Route = createFileRoute("/groups/")({
  component: GroupsPage,
});

const MY_GROUPS = graphql(`
  query MyGroups {
    myGroups {
      id
      name
      overlapThreshold
      members {
        id
      }
      activeVote {
        id
        status
      }
    }
  }
`);

function GroupsPage() {
  const { data, loading, error } = useQuery(MY_GROUPS);

  if (loading) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (error) return <p className="p-8 text-destructive">{error.message}</p>;

  const groups = data?.myGroups ?? [];

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your Groups</h1>
        <Link
          to="/groups/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          New Group
        </Link>
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground">
          You're not in any groups yet. Create one to get started.
        </p>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                to="/groups/$groupId"
                params={{ groupId: group.id }}
                className="block rounded-lg border border-border p-4 hover:bg-accent transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{group.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {group.members.length} member{group.members.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {group.activeVote && (
                  <span className="mt-1 inline-block text-xs rounded-full bg-primary/10 text-primary px-2 py-0.5">
                    Vote active
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
