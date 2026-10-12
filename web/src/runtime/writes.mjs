import { Contract } from "ethers";
export function writes(address, abi, signer, send, simulate) {
  const contract = new Contract(address, abi, signer);
  return new Proxy(contract, {
    get(target, key) {
      let fragment;
      try {
        fragment = target.interface.getFunction(key);
      } catch {}
      if (fragment && ["nonpayable", "payable"].includes(fragment.stateMutability))
        return async (...args) => {
          if (simulate) await simulate(address, abi, key, args);
          const gas = await target[key].estimateGas(...args);
          return send({
            ...(await target[key].populateTransaction(...args)),
            gasLimit: (gas * 130n) / 100n + 10_000n,
          });
        };
      return Reflect.get(target, key);
    },
  });
}
