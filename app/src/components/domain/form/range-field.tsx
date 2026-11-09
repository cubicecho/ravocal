import {
  bindToForm,
  type FieldProps,
  splitProps,
  useFieldContext,
  useFieldError,
} from "@/components/app-form";
import { FormField } from "@/components/form-field";

type RangeFieldProps = FieldProps & {
  min: number;
  max: number;
  step?: number;
  /** The value in words, drawn at the end of the label row and read out as the slider's value. */
  format?: (value: number) => string;
};

/**
 * A slider over a number, which the registry has no bound field for. It is a native range input
 * inside `FormField`, so it gets the same label, description and error wiring as every other
 * field.
 */
function BoundRangeField(props: RangeFieldProps) {
  const [fieldProps, { min, max, step, format }] = splitProps(props);
  const field = useFieldContext<number>();
  const value = field.state.value;
  const text = format ? format(value) : String(value);

  return (
    <FormField
      {...fieldProps}
      error={useFieldError()}
      actionSlot={
        <span className="text-sm tabular-nums" aria-hidden>
          {text}
        </span>
      }
      controlSlot={
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={text}
          onChange={(e) => field.handleChange(Number(e.target.value))}
          onBlur={field.handleBlur}
          className="w-full accent-active"
        />
      }
    />
  );
}

export const RangeField = bindToForm<RangeFieldProps, number>(BoundRangeField, "RangeField");
