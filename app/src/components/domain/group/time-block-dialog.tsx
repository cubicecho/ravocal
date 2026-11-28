import { useMutation } from '@apollo/client';
import { useStore } from '@tanstack/react-form';
import { useMemo } from 'react';
import { graphql } from '@/__generated__/index.js';
import { SelectField, useAppForm } from '@/components/app-form';
import { DateField } from '@/components/date-field';
import { DialogLayout } from '@/components/dialog-layout';
import { dialogForm } from '@/components/domain/form/dialog-form';
import { FormError } from '@/components/domain/form/form-error';
import { FieldRow } from '@/components/field-row';
import { Button } from '@/components/ui/button';
import { dayOf, dayToDate, today } from '@/lib/day';
import { blockValues, dayChoices, instantOf, isOnGrid, SLOT_MINUTES, type TimeChoice } from '@/lib/time-grid';

const CREATE_TIME_BLOCK = graphql(`
  mutation CreateTimeBlock($groupId: UUID!, $startsAt: DateTime!, $endsAt: DateTime!) {
    createTimeBlock(values: { groupId: $groupId, startsAt: $startsAt, endsAt: $endsAt }) {
      id
    }
  }
`);

const UPDATE_TIME_BLOCK = graphql(`
  mutation UpdateTimeBlock($id: UUID!, $startsAt: DateTime!, $endsAt: DateTime!) {
    updateTimeBlock(where: { id: { eq: $id } }, set: { startsAt: $startsAt, endsAt: $endsAt }) {
      id
      startsAt
      endsAt
    }
  }
`);

/** A block being edited: its id and its ends as the server has them. */
export interface EditedBlock {
  id: string;
  startsAt: string;
  endsAt: string;
}

interface TimeBlockDialogProps {
  groupId: string;
  /** The block to edit, or undefined to add one. */
  block: EditedBlock | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The form's values: the day as the date picker holds it (its local midnight), each end as a time choice's value. */
interface BlockFormValues {
  day: Date | null;
  start: string;
  end: string;
}

/** The reader's zone, as the description names it: "Europe/Paris". */
const READER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Whether the reader's half hours are the server's, which is false a quarter hour off UTC (Nepal, Chatham). */
function isOffGrid(choices: readonly TimeChoice[]): boolean {
  return choices.some((choice) => Number(choice.value) % SLOT_MINUTES !== 0);
}

/** The picked date as the day the grid works on: the date picker holds its local midnight. */
function dayOfPick(picked: Date | null): string {
  return picked === null ? '' : (dayOf(picked) ?? '');
}

/**
 * Adds or edits a block of free time: a date, a start and an end up to a day later (past midnight too), in the reader's
 * own time zone, every choice on the server's half-hour grid in UTC (`lib/time-grid.ts`).
 *
 * @param props - The group, the block when it is an edit, and the dialog's open state.
 * @returns The dialog.
 */
export function TimeBlockDialog({ groupId, block, open, onOpenChange }: TimeBlockDialogProps) {
  const isEdit = block !== undefined;
  const initial = useMemo(() => (block ? blockValues(block.startsAt, block.endsAt) : undefined), [block]);
  const options = { refetchQueries: ['GroupDetail'], awaitRefetchQueries: true, onError: () => {} };
  const [createBlock, created] = useMutation(CREATE_TIME_BLOCK, options);
  const [updateBlock, updated] = useMutation(UPDATE_TIME_BLOCK, options);

  const defaultValues = useMemo(
    (): BlockFormValues => ({
      day: dayToDate(initial?.day ?? today()),
      start: initial?.start ?? '',
      end: initial?.end ?? '',
    }),
    [initial],
  );
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      const day = dayOfPick(value.day);
      const startsAt = instantOf(day, value.start);
      const endsAt = instantOf(day, value.end);
      // The validators have the choices; this is the guard that nothing off the grid is ever sent.
      if (
        startsAt === undefined ||
        endsAt === undefined ||
        isOnGrid(startsAt) === false ||
        isOnGrid(endsAt) === false
      ) {
        return;
      }
      const variables = { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
      const res = block
        ? await updateBlock({ variables: { id: block.id, ...variables } })
        : await createBlock({ variables: { groupId, ...variables } });
      if (res.data) {
        onOpenChange(false);
      }
    },
  });

  const day = dayOfPick(useStore(form.store, (state) => state.values.day));
  const start = useStore(form.store, (state) => state.values.start);
  const choices = useMemo(() => dayChoices(day, start), [day, start]);
  // An edited block's end that the start doesn't offer (one longer than a day) stays a choice, so it still shows.
  const endChoices = initial?.extraEnd && day === initial.day ? [...choices.ends, initial.extraEnd] : choices.ends;
  const offered = (list: readonly TimeChoice[], value: string) => list.some((choice) => choice.value === value);

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={isEdit ? 'Edit free time' : 'Add free time'}
      description={
        isOffGrid(choices.starts)
          ? `Times are in your time zone (${READER_ZONE}). Free time is kept on the half hour in UTC, which is :15 and :45 where you are.`
          : `Times are in your time zone (${READER_ZONE}), on the half hour.`
      }
      hasUnsavedChanges={() => form.state.isDefaultValue === false}
      wrapperSlot={dialogForm(form.AppForm, form.handleSubmit)}
      contentSlot={
        <>
          <DateField
            form={form}
            name="day"
            label="Date"
            required
            clearable={false}
            validators={{
              onChange: ({ value }) => (value === null ? 'Choose a date.' : undefined),
            }}
          />
          <FieldRow
            contentSlot={
              <>
                <SelectField
                  form={form}
                  name="start"
                  label="From"
                  placeholder="Start"
                  options={choices.starts}
                  searchable
                  searchPlaceholder="Search times"
                  required
                  validators={{
                    onChangeListenTo: ['day'],
                    onChange: ({ value, fieldApi }) => {
                      if (value === '') {
                        return 'Choose when you are free from.';
                      }
                      const starts = dayChoices(dayOfPick(fieldApi.form.getFieldValue('day'))).starts;
                      return offered(starts, value) ? undefined : 'Choose a start on this date.';
                    },
                  }}
                />
                <SelectField
                  form={form}
                  name="end"
                  label="Until"
                  placeholder="End"
                  options={endChoices}
                  searchable
                  searchPlaceholder="Search times"
                  required
                  validators={{
                    onChangeListenTo: ['day', 'start'],
                    onChange: ({ value, fieldApi }) => {
                      if (value === '') {
                        return 'Choose when you are free until.';
                      }
                      const currentDay = dayOfPick(fieldApi.form.getFieldValue('day'));
                      const currentStart = fieldApi.form.getFieldValue('start');
                      if (currentStart !== '' && Number(value) <= Number(currentStart)) {
                        return 'The end has to be after the start.';
                      }
                      const isKept = initial?.extraEnd?.value === value && currentDay === initial.day;
                      const isOffered = offered(dayChoices(currentDay, currentStart).ends, value);
                      return isOffered || isKept ? undefined : 'Choose an end within a day of the start.';
                    },
                  }}
                />
              </>
            }
          />
          <FormError error={created.error ?? updated.error} />
        </>
      }
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onClick={close} content="Cancel" />
          <form.SubmitButton
            variant={isEdit ? 'positive' : 'info'}
            isEdit={isEdit}
            createLabel="Add free time"
            editLabel="Save changes"
            loadingLabel={isEdit ? 'Saving…' : 'Adding…'}
            requireChanges={isEdit}
          />
        </>
      )}
    />
  );
}
