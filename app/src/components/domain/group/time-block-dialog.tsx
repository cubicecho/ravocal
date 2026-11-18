import { useMutation } from '@apollo/client';
import { useStore } from '@tanstack/react-form';
import { useMemo } from 'react';
import { graphql } from '@/__generated__/index.js';
import { InputField, SelectField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { dialogForm } from '@/components/domain/form/dialog-form';
import { FormError } from '@/components/domain/form/form-error';
import { FieldRow } from '@/components/field-row';
import { Button } from '@/components/ui/button';
import {
  blockValues,
  dayChoices,
  instantOf,
  isOnGrid,
  localDayOf,
  SLOT_MINUTES,
  startOfLocalDay,
  type TimeChoice,
} from '@/lib/time-grid';

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

/** The reader's zone, as the description names it: "Europe/Paris". */
const READER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Whether the reader's half hours are the server's, which is false a quarter hour off UTC (Nepal, Chatham). */
function isOffGrid(choices: readonly TimeChoice[]): boolean {
  return choices.some((choice) => Number(choice.value) % SLOT_MINUTES !== 0);
}

/**
 * Adds or edits a block of free time: a date, a start and an end, in the reader's own time zone, every choice on the
 * server's half-hour grid in UTC (`lib/time-grid.ts`).
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

  const form = useAppForm({
    defaultValues: {
      day: initial?.day ?? localDayOf(new Date()),
      start: initial?.start ?? '',
      end: initial?.end ?? '',
    },
    onSubmit: async ({ value }) => {
      const startsAt = instantOf(value.day, value.start);
      const endsAt = instantOf(value.day, value.end);
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

  const day = useStore(form.store, (state) => state.values.day);
  const choices = useMemo(() => dayChoices(day), [day]);
  // An edited block's end that the day doesn't offer (one longer than a day) stays a choice, so it still shows.
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
          <InputField
            form={form}
            name="day"
            label="Date"
            type="date"
            required
            validators={{
              onChange: ({ value }) => (startOfLocalDay(value) ? undefined : 'Choose a date.'),
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
                      const starts = dayChoices(fieldApi.form.getFieldValue('day')).starts;
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
                      const currentDay = fieldApi.form.getFieldValue('day');
                      const ends = dayChoices(currentDay).ends;
                      const isKept = initial?.extraEnd?.value === value && currentDay === initial.day;
                      if (offered(ends, value) === false && isKept === false) {
                        return 'Choose an end on this date.';
                      }
                      const start = fieldApi.form.getFieldValue('start');
                      return start !== '' && Number(value) <= Number(start)
                        ? 'The end has to be after the start.'
                        : undefined;
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
