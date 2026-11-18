import { useMutation } from '@apollo/client';
import { useEffect, useId, useRef, useState } from 'react';
import { graphql } from '@/__generated__/index.js';
import { useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { dialogForm } from '@/components/domain/form/dialog-form';
import { FormError } from '@/components/domain/form/form-error';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Plus, X } from '@/components/ui/icons';
import { messageOf } from '@/lib/error-message';
import { formatWindow } from '@/lib/time-window';

const SUBMIT_RANKINGS = graphql(`
  mutation SubmitRankings($voteId: UUID!, $rankings: [RankingInput!]!) {
    submitRankings(voteId: $voteId, rankings: $rankings) {
      id
      slotId
      rank
    }
  }
`);

/** A candidate as the ballot needs it. */
export interface Candidate {
  id: string;
  startsAt: string;
  endsAt: string;
  overlapCount: number;
}

interface RankingDialogProps {
  voteId: string;
  /** Every candidate, in ballot order. */
  candidates: readonly Candidate[];
  /** The reader's saved ballot: slot ids, top choice first. Empty when they haven't ranked. */
  saved: readonly string[];
  memberCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Which button to put focus back on once a row has moved, since the row it was in is now somewhere else. */
type Move = 'up' | 'down' | 'remove' | 'add';

interface BallotEditorProps {
  ranked: readonly string[];
  onChange: (ranked: string[]) => void;
  candidates: readonly Candidate[];
  memberCount: number;
  /** What an empty ranking says. */
  emptyTitle: string;
}

/**
 * The ballot as two lists: the reader's order, with buttons to move each time up or down or take it off, and the
 * times left out, with a button to add each one at the bottom. Focus follows the time that moved, and a live region
 * says where it went.
 */
function BallotEditor({ ranked, onChange, candidates, memberCount, emptyTitle }: BallotEditorProps) {
  const baseId = useId();
  const [announcement, setAnnouncement] = useState('');
  const focusNext = useRef<string | null>(null);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const isRanked = new Set(ranked);
  const unranked = candidates.filter((candidate) => isRanked.has(candidate.id) === false);
  const buttonId = (move: Move, slotId: string) => `${baseId}-${move}-${slotId}`;
  const whenOf = (slotId: string) => {
    const candidate = byId.get(slotId);
    return candidate ? formatWindow(candidate.startsAt, candidate.endsAt) : 'This time';
  };

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target !== null) {
      document.getElementById(target)?.focus();
    }
  });

  const move = (index: number, by: -1 | 1) => {
    const next = [...ranked];
    const to = index + by;
    const [slotId] = next.splice(index, 1);
    if (slotId === undefined) {
      return;
    }
    next.splice(to, 0, slotId);
    // At the top the up button is disabled, so focus goes to the down one, and the same at the bottom.
    const isEnd = to === 0 || to === next.length - 1;
    const direction = by < 0 ? 'up' : 'down';
    const opposite = by < 0 ? 'down' : 'up';
    focusNext.current = buttonId(isEnd && next.length > 1 ? opposite : direction, slotId);
    setAnnouncement(`${whenOf(slotId)} moved to ${to + 1} of ${next.length}.`);
    onChange(next);
  };

  const remove = (index: number) => {
    const slotId = ranked[index];
    if (slotId === undefined) {
      return;
    }
    const next = ranked.filter((id) => id !== slotId);
    const neighbour = next[index] ?? next[index - 1];
    focusNext.current = neighbour === undefined ? buttonId('add', slotId) : buttonId('remove', neighbour);
    setAnnouncement(`${whenOf(slotId)} taken off your ranking.`);
    onChange(next);
  };

  const add = (slotId: string) => {
    const next = [...ranked, slotId];
    focusNext.current = buttonId('remove', slotId);
    setAnnouncement(`${whenOf(slotId)} added at ${next.length} of ${next.length}.`);
    onChange(next);
  };

  const free = (candidate: Candidate | undefined) =>
    candidate ? `${candidate.overlapCount} of ${memberCount} free` : undefined;

  return (
    <>
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
      <Section
        level={3}
        title="Your ranking"
        description="Your first choice at the top."
        contentSlot={
          ranked.length === 0 ? (
            <EmptyState compact title={emptyTitle} />
          ) : (
            <List
              label="Your ranking"
              contentSlot={ranked.map((slotId, index) => {
                const when = whenOf(slotId);
                return (
                  <ListItem
                    key={slotId}
                    leadingSlot={
                      <span className="w-6 text-center text-sm font-semibold tabular-nums" aria-hidden>
                        {index + 1}
                      </span>
                    }
                    title={when}
                    description={free(byId.get(slotId))}
                    actionSlot={
                      <>
                        <Button
                          id={buttonId('up', slotId)}
                          size="icon-sm"
                          variant="outline"
                          aria-label={`Move ${when} up`}
                          iconSlot={<ChevronUp />}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        />
                        <Button
                          id={buttonId('down', slotId)}
                          size="icon-sm"
                          variant="outline"
                          aria-label={`Move ${when} down`}
                          iconSlot={<ChevronDown />}
                          disabled={index === ranked.length - 1}
                          onClick={() => move(index, 1)}
                        />
                        <Button
                          id={buttonId('remove', slotId)}
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Take ${when} off your ranking`}
                          iconSlot={<X />}
                          onClick={() => remove(index)}
                        />
                      </>
                    }
                  />
                );
              })}
            />
          )
        }
      />
      {unranked.length > 0 ? (
        <Section
          level={3}
          title="Not ranked"
          description="Times you can't make can stay here: your ballot never counts for them."
          contentSlot={
            <List
              label="Not ranked"
              contentSlot={unranked.map((candidate) => {
                const when = formatWindow(candidate.startsAt, candidate.endsAt);
                return (
                  <ListItem
                    key={candidate.id}
                    title={when}
                    description={free(candidate)}
                    actionSlot={
                      <Button
                        id={buttonId('add', candidate.id)}
                        size="sm"
                        variant="outline"
                        aria-label={`Add ${when} to your ranking`}
                        iconSlot={<Plus />}
                        onClick={() => add(candidate.id)}
                        content="Add"
                      />
                    }
                  />
                );
              })}
            />
          }
        />
      ) : null}
    </>
  );
}

/**
 * The reader's ballot for an open vote, as an explicit form: they order the times they can make and save. Before
 * their first save the ballot starts as every time in the vote's own order; after it, as what they saved.
 *
 * @param props - The vote, its candidates, the saved ballot and the dialog's open state.
 * @returns The dialog.
 */
export function RankingDialog({ voteId, candidates, saved, memberCount, open, onOpenChange }: RankingDialogProps) {
  const hasSaved = saved.length > 0;
  const [submitRankings, { error }] = useMutation(SUBMIT_RANKINGS, {
    refetchQueries: ['GroupDetail'],
    awaitRefetchQueries: true,
    onError: () => {},
  });
  const form = useAppForm({
    defaultValues: { ranked: hasSaved ? [...saved] : candidates.map((candidate) => candidate.id) },
    onSubmit: async ({ value }) => {
      const rankings = value.ranked.map((slotId, index) => ({ slotId, rank: index + 1 }));
      const res = await submitRankings({ variables: { voteId, rankings } });
      if (res.data) {
        onOpenChange(false);
      }
    },
  });

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={hasSaved ? 'Change your ranking' : 'Rank the times'}
      description="Put the times you can make in the order you'd like them. When the owner closes the vote, the times with the fewest first choices drop out, round by round, until one has a majority."
      hasUnsavedChanges={() => form.state.isDefaultValue === false}
      wrapperSlot={dialogForm(form.AppForm, form.handleSubmit)}
      contentSlot={
        <>
          <form.AppField
            name="ranked"
            validators={{
              // An empty ballot withdraws one that was saved; with nothing saved there is nothing to send.
              onChange: ({ value }) =>
                value.length === 0 && hasSaved === false ? 'Add at least one time to rank.' : undefined,
            }}
          >
            {(field) => (
              <>
                <BallotEditor
                  ranked={field.state.value}
                  onChange={(next) => field.handleChange(next)}
                  candidates={candidates}
                  memberCount={memberCount}
                  emptyTitle={
                    hasSaved
                      ? 'No times ranked. Saving now withdraws your ballot.'
                      : 'No times ranked yet. Add the ones you can make.'
                  }
                />
                <FormError error={messageOf(field.state.meta.errors[0])} />
              </>
            )}
          </form.AppField>
          <FormError error={error} />
        </>
      }
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onClick={close} content="Cancel" />
          <form.SubmitButton
            createLabel="Save ranking"
            loadingLabel="Saving…"
            // A saved ballot is already what is shown; a new one is worth saving untouched.
            requireChanges={hasSaved}
          />
        </>
      )}
    />
  );
}
