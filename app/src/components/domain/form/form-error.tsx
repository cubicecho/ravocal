import { describeError } from "@/lib/error-message";

/**
 * What went wrong with a submit, under the fields: the mutation's failure, which belongs to no one
 * field. Nothing is drawn while there is no error.
 */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-negative">
      {describeError(error)}
    </p>
  );
}
