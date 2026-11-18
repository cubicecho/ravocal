import { useApolloClient, useMutation, useQuery } from '@apollo/client';
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
import { Plus, Settings } from '@/components/ui/icons';
import { asQuery } from '@/lib/as-query';
import { clearToken, LOGIN_PATH } from '@/lib/auth';

export const Route = createFileRoute('/groups/')({
  component: GroupsPage,
});

const SIGN_OUT = graphql(`
  mutation SignOut {
    signOut {
      success
    }
  }
`);

// `scope` confines `groups` to the reader's own, so this is "my groups" without saying so.
const MY_GROUPS = graphql(`
  query MyGroups {
    groups {
      id
      name
      overlapThreshold
      membersAggregate {
        count
      }
      votes(where: { status: { eq: active } }, limit: 1) {
        id
      }
    }
  }
`);

function GroupsPage() {
  const result = useQuery(MY_GROUPS);
  const groups = result.data?.groups ?? [];
  const client = useApolloClient();
  const navigate = useNavigate();

  const [signOut] = useMutation(SIGN_OUT, {
    // Signed out on this device whether or not the server could be told: the token is dropped below either way.
    onError: () => {},
  });

  const leave = async () => {
    // Ends the session on the server, so its token stops working anywhere it was copied.
    await signOut();
    clearToken();
    // Nothing the last account fetched may show to the next one.
    await client.clearStore();
    await navigate({ to: LOGIN_PATH });
  };

  return (
    <PageLayout
      title="Your groups"
      actionSlot={
        <>
          <Button
            size="sm"
            variant="outline"
            iconSlot={<Settings />}
            linkSlot={<Link to="/settings" />}
            content="Settings"
          />
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
                description={`${group.membersAggregate.count} ${group.membersAggregate.count === 1 ? 'member' : 'members'}`}
                linkSlot={<Link to="/groups/$groupId" params={{ groupId: group.id }} />}
                meta={group.votes.length > 0 ? <Badge variant="info-soft">Vote active</Badge> : undefined}
              />
            ))}
          />
        </>
      }
    />
  );
}
