import { useApolloClient, useQuery } from '@apollo/client';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { graphql } from '@/__generated__/index.js';
import { Users } from '@/components/domain/app-icons';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { LoadState } from '@/components/load-state';
import { PageLayout } from '@/components/page-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons';
import { asQuery } from '@/lib/as-query';
import { signOut } from '@/lib/auth';

export const Route = createFileRoute('/groups/')({
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
  const client = useApolloClient();
  const navigate = useNavigate();

  const leave = async () => {
    signOut();
    // Nothing the last account fetched may show to the next one.
    await client.clearStore();
    await navigate({ to: '/login' });
  };

  return (
    <PageLayout
      title="Your groups"
      actionSlot={
        <>
          <Button size="sm" variant="outline" onClick={() => void leave()} content="Sign out" />
          <Button
            size="sm"
            variant="info"
            iconSlot={<Plus />}
            linkSlot={<Link to="/groups/new" />}
            content="New group"
          />
        </>
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
                description={`${group.members.length} ${group.members.length === 1 ? 'member' : 'members'}`}
                linkSlot={<Link to="/groups/$groupId" params={{ groupId: group.id }} />}
                meta={group.activeVote ? <Badge variant="info-soft">Vote active</Badge> : undefined}
              />
            ))}
          />
        </>
      }
    />
  );
}
