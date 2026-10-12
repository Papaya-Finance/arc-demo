import React from "react";
import { BalanceWizard } from "./BalanceWizard.jsx";
export function WithdrawWizard(props) {
  return <BalanceWizard {...props} kind="withdraw" />;
}
