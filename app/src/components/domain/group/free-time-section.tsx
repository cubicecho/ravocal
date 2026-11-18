import { useMutation } from '@apollo/client';
import { useState } from 'react';
import type { GroupDetailQuery } from '@/__generated__/graphql.js';
import { graphql } from '@/__generated__/index.js';
import { ConfirmButton } from '@/components/confirm-button';
import { type EditedBlock, TimeBlockDialog } from '@/components/domain/group/time-block-dialog';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { Section } from '@/components/section';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Pencil, Plus } from '@/components/ui/icons';
import { describeError } from '@/lib/error-message';
import { byStart, formatWindow } from '@/lib/time-window';
import { useDialog } from '@/lib/use-dialog';

const DELETE_TIME_BLOCK = graphql(`
  mutation DeleteTimeBlock($id: UUID!) {
    deleteTimeBlock(where: { id: { eq: $id } }) {
      id
    }
  }
`);

type Group = NonNullable<GroupDetailQuery['group']>;
type Block = Group['timeBlocks'][number];

/** One member's blocks, under their name. */
interface MemberBlocks {
  userId: string;
  name: string;
  blocks: Block[];
}

/**
 * The group's free time by member, the reader's own first and then in the order they joined. A member with no free
 * time is left out, except the reader, who is told they have none.
 */
function byMember(group: Group, readerId: string | undefined): MemberBlocks[] {
  const sorted = [...group.timeBlocks].sort(byStart);
  const members = [...group.members].sort((a, b) => Number(b.userId === readerId) - Number(a.userId === readerId));
  return members
    .map((member) => ({
      userId: member.userId,
      name: member.userId === readerId ? 'You' : member.user.name || member.user.email,
      blocks: sorted.filter((block) => block.userId === member.userId),
    }))
    .filter((entry) => entry.blocks.length > 0 || entry.userId === readerId);
}

interface FreeTimeSectionProps {
  group: Group;
  readerId: string | undefined;
}

/**
 * Free time: every member's blocks, and the reader's own with Edit and Delete. "Add free time" is everyone's.
 *
 * @param props - The group and who is reading.
 * @returns The section.
 */
export function FreeTimeSection({ group, readerId }: FreeTimeSectionProps) {
  const dialog = useDialog();
  const [editing, setEditing] = useState<EditedBlock | undefined>(undefined);
  // The block whose Delete was confirmed last, so only its button spins.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteBlock, deleting] = useMutation(DELETE_TIME_BLOCK, {
    refetchQueries: ['GroupDetail'],
    awaitRefetchQueries: true,
    onError: () => {},
  });

  const open = (block: EditedBlock | undefined) => {
    setEditing(block);
    dialog.show();
  };

  return (
    <Section
      title="Free time"
      description="When each member is free. A vote's candidate times come from where these overlap."
      actionSlot={
        <Button size="sm" variant="info" iconSlot={<Plus />} onClick={() => open(undefined)} content="Add free time" />
      }
      contentSlot={
        <>
          {deleting.error ? (
            <Alert
              variant="destructive"
              title="Couldn't delete that time"
              description={describeError(deleting.error)}
            />
          ) : null}
          {byMember(group, readerId).map((entry) => {
            const isMine = entry.userId === readerId;
            return (
              <Section
                key={entry.userId}
                level={3}
                title={entry.name}
                // Under the section's own heading, a step quieter, so a member's name doesn't read as a section.
                titleClassName="text-foreground/70"
                contentSlot={
                  entry.blocks.length === 0 ? (
                    <EmptyState compact title="You haven't added any free time yet." />
                  ) : (
                    <List
                      label={isMine ? 'Your free time' : `${entry.name}'s free time`}
                      contentSlot={entry.blocks.map((block) => {
                        const when = formatWindow(block.startsAt, block.endsAt);
                        return (
                          <ListItem
                            key={block.id}
                            title={when}
                            actionSlot={
                              isMine ? (
                                <>
                                  <Button
                                    size="icon-sm"
                                    variant="outline"
                                    aria-label={`Edit ${when}`}
                                    iconSlot={<Pencil />}
                                    onClick={() => open(block)}
                                  />
                                  <ConfirmButton
                                    size="sm"
                                    loading={deleting.loading && deletingId === block.id}
                                    loadingLabel="Deleting…"
                                    disabled={deleting.loading}
                                    title="Delete this free time?"
                                    description={`${when} comes off the group's calendar. A vote that is already open keeps its times.`}
                                    confirmLabel="Delete"
                                    onConfirm={() => {
                                      setDeletingId(block.id);
                                      void deleteBlock({ variables: { id: block.id } });
                                    }}
                                    aria-label={`Delete ${when}`}
                                    content="Delete"
                                  />
                                </>
                              ) : undefined
                            }
                          />
                        );
                      })}
                    />
                  )
                }
              />
            );
          })}
          <TimeBlockDialog
            key={`time-block-${dialog.key}`}
            groupId={group.id}
            block={editing}
            open={dialog.open}
            onOpenChange={dialog.onOpenChange}
          />
        </>
      }
    />
  );
}
