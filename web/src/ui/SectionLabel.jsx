import React from "react";

/** 1:1 with papaya.finance SectionLabel: text-xs + ink/50, last segment ink/70. */
export function SectionLabel({ path }) {
  return (
    <p className="section-label">
      {path.map((segment, i) => (
        <span key={`${i}:${segment}`}>
          {i > 0 ? (
            <span aria-hidden className="section-label-sep">
              /
            </span>
          ) : null}
          <span className={i === path.length - 1 ? "section-label-current" : undefined}>
            {segment}
          </span>
        </span>
      ))}
    </p>
  );
}
