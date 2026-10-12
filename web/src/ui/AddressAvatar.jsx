import React, { useMemo } from "react";
import { createAvatar } from "@dicebear/core";
import * as loreleiNeutral from "@dicebear/lorelei-neutral";

/** Deterministic DiceBear lorelei-neutral face from a wallet address. */
export function AddressAvatar({ address, size = 40, className = "" }) {
  const src = useMemo(
    () =>
      createAvatar(loreleiNeutral, {
        seed: (address || "papaya").toLowerCase(),
        size,
        backgroundColor: ["transparent"],
      }).toDataUri(),
    [address, size],
  );

  return (
    <img
      className={`address-avatar ${className}`.trim()}
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden
    />
  );
}
