import { useEffect, useState } from "react";
import { FetchRequest, JsonRpcProvider } from "ethers";
const cache = new Map();
// ENS is an optional display enhancement. Failure never affects Arc reads or writes.
export function useEns(account) {
  const [resolved, setResolved] = useState({ account: "", name: null });
  useEffect(() => {
    if (!account || import.meta.env.VITE_ENS_RPC_URL === "disabled") return;
    if (cache.has(account)) {
      setResolved({ account, name: cache.get(account) });
      return;
    }
    let cancelled = false;
    const request = new FetchRequest(
      import.meta.env.VITE_ENS_RPC_URL || "https://ethereum-rpc.publicnode.com",
    );
    request.timeout = 5000;
    const provider = new JsonRpcProvider(request, 1, { staticNetwork: true, batchMaxCount: 1 });
    provider
      .lookupAddress(account)
      .then((name) => {
        if (!cancelled) {
          cache.set(account, name);
          setResolved({ account, name });
        }
      })
      .catch(() => {})
      .finally(() => provider.destroy());
    return () => {
      cancelled = true;
      provider.destroy();
    };
  }, [account]);
  return resolved.account === account ? resolved.name : null;
}
