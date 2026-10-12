import { useDismiss } from "./use-ui-lifecycle.jsx";
import React, { useId, useRef, useState } from "react";
import { Check, ChevronDown } from "./icons.mjs";

/** Custom rate picker — Papaya-styled listbox instead of the native OS select. */
export function RateSelect({ label, value, options, onChange, "aria-label": ariaLabel }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef(null);
  const selected = options.find((o) => o.value === value) || options[0];

  useDismiss(open, root, () => setOpen(false));

  return (
    <div className="rate-field" ref={root}>
      {label ? <span className="rate-field-label">{label}</span> : null}
      <button
        type="button"
        className={`rate-select${open ? " open" : ""}`}
        aria-label={ariaLabel || label || "Rate"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rate-select-value">{selected?.label}</span>
        <ChevronDown size={16} strokeWidth={2} aria-hidden className="rate-select-chevron" />
      </button>
      {open ? (
        <ul
          id={id}
          role="listbox"
          className="rate-select-menu"
          aria-label={ariaLabel || label || "Rate"}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <li key={option.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`rate-select-option${active ? " active" : ""}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                  {active ? <Check size={14} aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
