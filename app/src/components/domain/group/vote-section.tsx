import { useMutation } from '@apollo/client';
import type { GroupDetailQuery } from '@/__generated__/graphql.js';
import { graphql } from '@/__generated__/index.js';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { Trophy } from '@/components/domain/app-icons';
import { RankingDialog } from '@/components/domain/group/ranking-dialog';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { Section } from '@/components/section';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ErrorCode, hasErrorCode } from '@/lib/error-codes';
import { describeError } from '@/lib/error-message';
import { formatDay, formatWindow } from '@/lib/time-window';
import { useDialog } from '@/lib/use-dialog';

const START_VOTE = graphql(`
  mutation StartVote($groupId: UUID!) {
    startVote(groupId: $groupId) {
      id
    }
  }
`);

const FORCE_START_VOTE = graphql(`
  mutation ForceStartVote($groupId: UUID!) {
    forceStartVote(groupId: $groupId) {
      id
    }
  }
`);

const CLOSE_VOTE = graphql(`
  mutation CloseVote($voteId: UUID!) {
    closeVote(voteId: $voteId) {
      id
      status
      winnerSlotId
      closedAt
    }
  }
`);

type Group = NonNullable<GroupDetailQuery['group']>;
type Vote = Group['votes'][number];
type Slot = Vote['slots'][number];

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Every page change a vote makes reads the group again: the vote, its slots and the reader's ballot. */
const REFETCH = { refetchQueries: ['GroupDetail'], awaitRefetchQueries: true, onError: () => {} };

/**
 * How many of the group have ranked an open vote, and whether the reader is one of them. Never who the others are.
 */
function RankingProgress({ vote, memberCount, hasRanked }: { vote: Vote; memberCount: number; hasRanked: boolean }) {
  const ranked = vote.rankedCount;
  const counted = `${ranked} of ${plural(memberCount, 'member', 'members')} ${ranked === 1 ? 'has' : 'have'} ranked`;
  const summary = () => {
    if (ranked === 0) {
      return 'Nobody has ranked the times yet.';
    }
    if (ranked >= memberCount) {
      return 'Everyone has ranked the times.';
    }
    return hasRanked ? `${counted}, you among them.` : `${counted}. You haven't yet.`;
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-foreground/70">{summary()}</p>
      <Progress value={ranked} max={memberCount} label="Members who have ranked" valueLabel={counted} />
    </div>
  );
}

/**
 * The reader's ballot in an open vote: saved, in their order, or not yet, with the button that opens the form.
 */
function YourBallot({ vote, memberCount }: { vote: Vote; memberCount: number }) {
  const dialog = useDialog();
  const saved = [...vote.rankings].sort((a, b) => a.rank - b.rank).map((ranking) => ranking.slotId);
  const byId = new Map(vote.slots.map((slot) => [slot.id, slot]));
  const rankedSlots = saved.map((id) => byId.get(id)).filter((slot): slot is Slot => slot !== undefined);
  const isRanked = new Set(saved);
  const unranked = vote.slots.filter((slot) => isRanked.has(slot.id) === false);
  const hasSaved = rankedSlots.length > 0;
  const free = (slot: Slot) => `${slot.overlapCount} of ${memberCount} free`;

  return (
    <>
      <RankingProgress vote={vote} memberCount={memberCount} hasRanked={hasSaved} />
      <Alert
        variant={hasSaved ? 'info' : 'warning'}
        title={hasSaved ? 'Your ranking is saved' : "You haven't ranked the times yet"}
        description={
          hasSaved
            ? 'You can change it until the owner closes the vote.'
            : 'Put the times you can make in order, so your choice counts.'
        }
        actionSlot={
          <Button
            size="sm"
            variant={hasSaved ? 'outline' : 'info'}
            onClick={dialog.show}
            content={hasSaved ? 'Change ranking' : 'Rank the times'}
          />
        }
      />
      {hasSaved ? (
        <Section
          level={3}
          title="Your ranking"
          contentSlot={
            <List
              label="Your ranking"
              contentSlot={rankedSlots.map((slot, index) => (
                <ListItem
                  key={slot.id}
                  leadingSlot={<span className="w-6 text-center text-sm font-semibold tabular-nums">{index + 1}</span>}
                  title={formatWindow(slot.startsAt, slot.endsAt)}
                  meta={free(slot)}
                />
              ))}
            />
          }
        />
      ) : null}
      {unranked.length > 0 ? (
        <Section
          level={3}
          title={hasSaved ? 'Not ranked' : 'Candidate times'}
          contentSlot={
            <List
              label={hasSaved ? 'Not ranked' : 'Candidate times'}
              contentSlot={unranked.map((slot) => (
                <ListItem key={slot.id} title={formatWindow(slot.startsAt, slot.endsAt)} meta={free(slot)} />
              ))}
            />
          }
        />
      ) : null}
      <RankingDialog
        key={`ranking-${dialog.key}`}
        voteId={vote.id}
        candidates={vote.slots}
        saved={saved}
        memberCount={memberCount}
        open={dialog.open}
        onOpenChange={dialog.onOpenChange}
      />
    </>
  );
}

/**
 * A closed vote's result: the winning time on a card of its own, then every candidate with how many were free.
 */
function VoteResult({ vote }: { vote: Vote }) {
  const winner = vote.slots.find((slot) => slot.id === vote.winnerSlotId);
  const closed = vote.closedAt ? `Closed ${formatDay(vote.closedAt)}.` : 'Closed.';
  return (
    <>
      {winner ? (
        <CardLayout
          level={3}
          iconSlot={<Trophy />}
          title="Winning time"
          description={`${closed} Chosen by instant runoff from ${plural(vote.rankedCount, 'ballot', 'ballots')} over ${plural(vote.slots.length, 'candidate time', 'candidate times')}.`}
          contentSlot={
            <p className="text-xl font-semibold text-balance sm:text-2xl">
              {formatWindow(winner.startsAt, winner.endsAt)}
            </p>
          }
        />
      ) : (
        <Alert variant="warning" title="No winner" description={`${closed} Nobody ranked a time.`} />
      )}
      <Section
        level={3}
        title="All candidate times"
        contentSlot={
          <List
            label="All candidate times"
            contentSlot={vote.slots.map((slot) => (
              <ListItem
                key={slot.id}
                title={formatWindow(slot.startsAt, slot.endsAt)}
                meta={
                  slot.id === vote.winnerSlotId ? (
                    <Badge variant="positive-soft">Winner</Badge>
                  ) : (
                    // A slot's count is from when the vote opened; the group may be another size now.
                    `${slot.overlapCount} were free`
                  )
                }
              />
            ))}
          />
        }
      />
    </>
  );
}

interface VoteSectionProps {
  group: Group;
  isOwner: boolean;
}

/**
 * The group's vote: the owner starts one (or, when too few are free at once, a forced one) and closes it; every member
 * ranks the times while it is open; and once it has closed, everyone sees the winner.
 *
 * @param props - The group, and whether the reader owns it.
 * @returns The section.
 */
export function VoteSection({ group, isOwner }: VoteSectionProps) {
  const [vote] = group.votes;
  const isOpen = vote?.status === 'active';
  const memberCount = group.members.length;
  const [startVote, starting] = useMutation(START_VOTE, REFETCH);
  const [forceStartVote, forcing] = useMutation(FORCE_START_VOTE, {
    ...REFETCH,
    onCompleted: () => starting.reset(),
  });
  const [closeVote, closing] = useMutation(CLOSE_VOTE, REFETCH);

  // startVote's refusal with no vote open is the threshold's: the way past it is a forced vote.
  const isBelowThreshold = isOpen === false && hasErrorCode(starting.error, ErrorCode.BadUserInput);
  const failure = (isBelowThreshold ? undefined : starting.error) ?? forcing.error ?? closing.error;

  const start = () => {
    forcing.reset();
    void startVote({ variables: { groupId: group.id } });
  };

  const actions = () => {
    if (isOwner === false) {
      return undefined;
    }
    if (vote && isOpen) {
      return (
        <ConfirmButton
          size="sm"
          loading={closing.loading}
          loadingLabel="Closing…"
          title="Close the vote?"
          description="Ranking stops, and the winner is worked out from the ballots saved so far. Everyone is emailed the result."
          confirmLabel="Close vote"
          cancelLabel="Keep it open"
          onConfirm={() => void closeVote({ variables: { voteId: vote.id } })}
          content="Close vote"
        />
      );
    }
    return (
      <Button
        size="sm"
        variant="info"
        loading={starting.loading}
        loadingLabel="Starting…"
        disabled={forcing.loading}
        onClick={start}
        content={vote ? 'Start a new vote' : 'Start vote'}
      />
    );
  };

  const describe = () => {
    if (vote === undefined) {
      return undefined;
    }
    const times = plural(vote.slots.length, 'candidate time', 'candidate times');
    if (isOpen) {
      return vote.isForced
        ? `A forced vote over ${times}, the owner's free times first. Rank the ones you can make.`
        : `${times}, where enough of the group is free. Rank the ones you can make.`;
    }
    return vote.isForced
      ? "The last vote's result. It was forced, so the owner's free times came first."
      : "The last vote's result.";
  };

  const body = () => {
    if (vote === undefined) {
      return (
        <EmptyState
          compact
          title={
            isOwner
              ? 'No vote yet. Start one once the group has added free time.'
              : 'No vote yet. The owner starts one once the group has added free time.'
          }
        />
      );
    }
    return isOpen ? <YourBallot vote={vote} memberCount={memberCount} /> : <VoteResult vote={vote} />;
  };

  return (
    <Section
      title={isOpen ? 'Vote open' : 'Vote'}
      description={describe()}
      actionSlot={actions()}
      contentSlot={
        <>
          {isBelowThreshold ? (
            <Alert
              variant="warning"
              title="Not enough of the group is free at the same time"
              description={`${describeError(starting.error)} A forced vote puts your own free times first, then the times the most members can make.`}
              actionSlot={
                <Button
                  size="sm"
                  variant="info"
                  loading={forcing.loading}
                  loadingLabel="Starting…"
                  onClick={() => void forceStartVote({ variables: { groupId: group.id } })}
                  content="Start a forced vote"
                />
              }
            />
          ) : null}
          {failure ? (
            <Alert variant="destructive" title="That didn't work" description={describeError(failure)} />
          ) : null}
          {body()}
        </>
      }
    />
  );
}
