// ── Shared form-field helpers for admin doc forms ────────────────────────────
// Consumed by: /admin/docs/new and /admin/docs/[id]

export type FieldProps = {
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  mono?: boolean;
  icon?: React.ReactNode;
  pattern?: string;
  defaultValue?: string;
};

export function Field({
  name,
  label,
  required = false,
  hint,
  placeholder,
  mono = false,
  icon,
  pattern,
  defaultValue,
}: FieldProps) {
  const hasAdornment = icon !== undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <label
          htmlFor={name}
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]"
        >
          {label}
        </label>
        {required && (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#00e5ff]">
            Required
          </span>
        )}
      </div>

      {/* Input wrapper */}
      <div className="relative flex items-center">
        {icon && (
          <span className="pointer-events-none absolute left-3 flex items-center text-[#8a8a93]/50">
            {icon}
          </span>
        )}

        <input
          id={name}
          name={name}
          type="text"
          required={required}
          placeholder={placeholder}
          pattern={pattern}
          defaultValue={defaultValue}
          className={[
            "w-full rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#030305] py-2.5 text-sm text-white",
            "placeholder:text-[#8a8a93]/50",
            "focus:border-[#00e5ff] focus:outline-none",
            "transition-colors duration-150",
            "focus:[box-shadow:0_0_0_1px_#00e5ff,0_0_12px_rgba(0,229,255,0.10)]",
            mono ? "font-mono text-[13px]" : "font-sans",
            hasAdornment ? "pl-9 pr-4" : "px-4",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      </div>

      {hint && <p className="font-sans text-[12px] text-[#8a8a93]">{hint}</p>}
    </div>
  );
}

export type SelectFieldProps = {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
};

export function SelectField({ name, label, options, defaultValue }: SelectFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={name}
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]"
      >
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#030305] px-4 py-2.5 font-mono text-[13px] text-white focus:border-[#00e5ff] focus:outline-none focus:[box-shadow:0_0_0_1px_#00e5ff,0_0_12px_rgba(0,229,255,0.10)] transition-colors duration-150"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export type TextareaFieldProps = {
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  rows?: number;
  defaultValue?: string;
};

export function TextareaField({
  name,
  label,
  required = false,
  hint,
  placeholder,
  rows = 20,
  defaultValue,
}: TextareaFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <label
          htmlFor={name}
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a93]"
        >
          {label}
        </label>
        {required && (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#00e5ff]">
            Required
          </span>
        )}
      </div>

      <textarea
        id={name}
        name={name}
        required={required}
        placeholder={placeholder}
        rows={rows}
        defaultValue={defaultValue}
        className="w-full rounded-sm border border-[rgba(255,255,255,0.08)] bg-[#030305] px-4 py-2.5 font-mono text-[13px] text-white placeholder:text-[#8a8a93]/50 focus:border-[#00e5ff] focus:outline-none focus:[box-shadow:0_0_0_1px_#00e5ff,0_0_12px_rgba(0,229,255,0.10)] transition-colors duration-150 resize-y"
      />

      {hint && <p className="font-sans text-[12px] text-[#8a8a93]">{hint}</p>}
    </div>
  );
}
