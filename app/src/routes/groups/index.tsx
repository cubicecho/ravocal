import { useQuery } from "@apollo/client";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { graphql } from "@/__generated__/index.js";
import { EmptyState } from "@/components/empty-state";
import { List } from "@/components/list";
import { ListItem } from "@/components/list-item";
import { LoadState } from "@/components/load-state";
import { PageLayout } from "@/components/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "@/components/ui/icons";
import { asQuery } from "@/lib/as-query";

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
  const result = useQuery(MY_GROUPS);
  const groups = result.data?.myGroups ?? [];

  return (
    <PageLayout
      title="Your Groups"
      actionSlot={
        <Button
          size="sm"
          variant="info"
          iconSlot={<Plus />}
          linkSlot={<Link to="/groups/new" />}
          content="New Group"
        />
      }
      width="prose"
      contentSlot={
        <>
          <LoadState
            query={asQuery(result)}
            what="your groups"
            count={groups.length}
            emptySlot={
              <EmptyState
                iconSlot={<Users />}
                title="You're not in any groups yet"
                description="Create one to get started, or open an invite from your email."
              />
            }
          />
          <List
            label="Groups"
            contentSlot={groups.map((group) => (
              <ListItem
                key={group.id}
                title={group.name}
                linkSlot={<Link to="/groups/$groupId" params={{ groupId: group.id }} />}
                meta={
                  <>
                    {group.activeVote && <Badge variant="info-soft">Vote active</Badge>}
                    <span className="text-xs text-foreground/60">
                      {group.members.length} member{group.members.length !== 1 ? "s" : ""}
                    </span>
                  </>
                }
              />
            ))}
          />
        </>
      }
    />
  );
}
