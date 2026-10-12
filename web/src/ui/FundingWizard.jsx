import React from "react";
import { BalanceWizard } from "./BalanceWizard.jsx";
export function FundingWizard(props) {
  return <BalanceWizard {...props} kind="funding" />;
}
