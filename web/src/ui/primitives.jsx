import React, { useEffect, useRef, useState } from "react";
import { X, Copy, Check, ArrowRight } from "./icons.mjs";
import { formatUnits } from "ethers";
export const amount = (value = 0n, decimals = 18) => formatUnits(value, decimals);
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
export function Money({ value, decimals = 18, precision = 8 }) {
  const text =
    value == null
      ? "—"
      : Number(formatUnits(value, decimals)).toLocaleString("en-US", {
          maximumFractionDigits: precision,
          minimumFractionDigits: 2,
        });
  return (
    <span
      className="money"
      title={value == null ? "Not loaded" : `${formatUnits(value, decimals)} USDC`}
    >
      <span key={text} className="number-tick">
        {text}
      </span>
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  drawer = false,
  className = "",
  headerCenter = null,
}) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const previous = document.activeElement;
    el.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      el.close();
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, []);
  const shell = `${drawer ? "drawer" : "modal"}${className ? ` ${className}` : ""}`;
  const titleBar = drawer || /\b(wallet-modal|funding-modal|review-modal)\b/.test(className);
  const topClass = `dialog-top${headerCenter ? (title ? " dialog-top-triple" : " dialog-top-stepper") : ""}`;
  return (
    <dialog
      ref={ref}
      className={shell}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className={topClass}>
        {titleBar && title ? (
          <h2 id="dialog-title">{title}</h2>
        ) : !titleBar ? (
          <span className="eyebrow">PAPAYA / ARC</span>
        ) : null}
        {headerCenter ? <div className="dialog-top-center">{headerCenter}</div> : null}
        <button
          className={`icon-button${titleBar ? " dialog-close" : ""}`}
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {!titleBar && <h2 id="dialog-title">{title}</h2>}
      {children}
    </dialog>
  );
}
export function CopyButton({ value, label = "Copy" }) {
  const [state, setState] = useState("");
  return (
    <button
      className="icon-button"
      title={state || label}
      aria-label={state || label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("Copied");
        } catch {
          setState("Copy unavailable");
        }
      }}
    >
      {state === "Copied" ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}
export function ExternalLink({ href, children, ...props }) {
  const valid = /^https:\/\//.test(href || "");
  return valid ? (
    <a href={href} target="_blank" rel="noreferrer" {...props}>
      {children}
      <ArrowRight size={14} />
    </a>
  ) : (
    <button className="link-placeholder" disabled title="Link coming soon" {...props}>
      {children}
    </button>
  );
}
