import { appKitInstance } from "./appkit-cache.mjs";
import { BrowserProvider, formatEther } from "ethers";
import { rpcUrls } from "./rpc.mjs";
import { readStored, writeStored, scopeKey } from "./storage.mjs";
export class WalletSession {
  constructor({
    config,
    storage,
    onChange = () => {},
    onError = () => {},
    makeProvider = (raw) => new BrowserProvider(raw, "any", { cacheTimeout: -1 }),
  }) {
    Object.assign(this, { config, storage, onChange, onError, makeProvider });
    this.key = `papaya:wallet:${scopeKey(config)}`;
    this.generation = 0;
    this.state = {
      account: "",
      signer: null,
      status: "disconnected",
      revision: 0,
    };
  }
  emit(next) {
    if (this.destroyed) return;
    this.state = { ...this.state, ...next, revision: this.state.revision + 1 };
    this.onChange(this.state);
  }
  detach() {
    for (const [event, listener] of this.listeners || [])
      this.raw?.removeListener?.(event, listener);
    this.listeners = [];
  }
  async attach(raw, { request = false, restore = false } = {}) {
    if (this.destroyed) return;
    if (restore && readStored(this.storage, this.key, {}).disconnected) return;
    if (raw !== this.raw) {
      this.detach();
      this.raw = raw;
      if (raw) {
        this.listeners = [
          [
            "accountsChanged",
            (accounts) => {
              this.sync(accounts).catch(this.onError);
            },
          ],
          [
            "chainChanged",
            () => {
              this.sync().catch(this.onError);
            },
          ],
          ["disconnect", () => this.clear(false)],
          [
            "connect",
            () => {
              this.sync().catch(this.onError);
            },
          ],
        ];
        for (const [event, listener] of this.listeners) raw.on?.(event, listener);
      }
    }
    if (!raw) {
      this.clear(false);
      return;
    }
    if (request) {
      writeStored(this.storage, this.key, { disconnected: false });
      await raw.request({ method: "eth_requestAccounts" });
      await this.switchChain();
    }
    return this.sync();
  }
  async switchChain() {
    const chainId = `0x${this.config.chainId.toString(16)}`;
    if (BigInt(await this.raw.request({ method: "eth_chainId" })) === BigInt(this.config.chainId))
      return;
    try {
      await this.raw.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }],
      });
    } catch (error) {
      if (Number(error.code ?? error?.data?.originalError?.code) !== 4902) throw error;
      await this.raw.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId,
            chainName: this.config.chainId === 5042 ? "Arc" : "Papaya local Arc fork",
            rpcUrls: [this.config.rpcUrl],
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
            ...(this.config.explorer ? { blockExplorerUrls: [this.config.explorer] } : {}),
          },
        ],
      });
      await this.raw.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }],
      });
    }
  }
  async sync(accounts) {
    if (this.destroyed) return;
    const raw = this.raw,
      generation = ++this.generation;
    // Disable writes immediately while replacing the signer; keep known read data.
    this.emit({ signer: null, status: "connecting" });
    try {
      if (!raw) return;
      const [permitted, chain] = await Promise.all([
        accounts || raw.request({ method: "eth_accounts" }),
        raw.request({ method: "eth_chainId" }),
      ]);
      if (generation !== this.generation) return;
      if (!permitted.length) {
        this.clear(false);
        return;
      }
      const account = permitted[0],
        chainId = Number(BigInt(chain));
      this.provider?.destroy?.();
      const provider = this.makeProvider(raw);
      this.provider = provider;
      const signer = chainId === this.config.chainId ? await provider.getSigner(account) : null;
      if (generation !== this.generation) {
        provider.destroy?.();
        return;
      }
      writeStored(this.storage, this.key, { disconnected: false });
      this.emit({
        account,
        chainId,
        provider,
        signer,
        status: signer ? "connected" : "wrong_chain",
      });
    } catch (error) {
      if (generation === this.generation) {
        this.emit({ signer: null, status: "error" });
        this.onError(error);
      }
    }
  }
  async assertCurrent(account) {
    const [accounts, chain] = await Promise.all([
      this.raw.request({ method: "eth_accounts" }),
      this.raw.request({ method: "eth_chainId" }),
    ]);
    if (
      BigInt(chain) !== BigInt(this.config.chainId) ||
      accounts[0]?.toLowerCase() !== account.toLowerCase()
    )
      throw Error("Wallet changed; reconnect");
  }
  async send(request, account) {
    await this.assertCurrent(account);
    // Request the raw EIP-1193 hash, not ethers.sendTransaction (which performs
    // a second RPC lookup before handing the hash back to the application).
    const hash = await this.raw.request({
      method: "eth_sendTransaction",
      params: [
        this.provider.getRpcTransaction({
          ...request,
          from: account,
          chainId: BigInt(this.config.chainId),
        }),
      ],
    });
    return { hash };
  }
  clear(explicit = true) {
    this.generation++;
    this.provider?.destroy?.();
    this.provider = null;
    if (explicit) {
      this.detach();
      this.raw = null;
      writeStored(this.storage, this.key, { disconnected: true });
    }
    this.emit({
      account: "",
      signer: null,
      provider: null,
      chainId: null,
      status: "disconnected",
    });
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation++;
    this.detach();
    this.provider?.destroy?.();
  }
}
// Use the SDK wallet picker/account dialog through the existing page button.
// No app layout, typography or CSS is replaced by AppKit components.
export async function createWalletConnector(
  config,
  session,
  projectId,
  loadSdk = () => import(/* @vite-ignore */ __PAPAYA_WALLET_MODULE__).then((sdk) => [sdk, sdk]),
  { rpc, env = {}, signal } = {},
) {
  signal?.throwIfAborted();
  if (config.chainId === 5042 && !projectId)
    throw Error(
      "WalletConnect configuration is missing from this build. A configured frontend release is required.",
    );
  if (config.chainId !== 5042) {
    const injected = () =>
      window.ethereum?.providers?.find((p) => p.isRabby) ||
      window.ethereum?.providers?.find((p) => p.isMetaMask) ||
      window.ethereum;
    await session.attach(injected(), { restore: true });
    return {
      async open() {
        if (session.state.status === "connected") {
          session.clear(true);
          return;
        }
        if (!injected())
          throw Error("Install an Ethereum wallet such as MetaMask or Rabby to connect.");
        return session.attach(injected(), { request: true });
      },
      async disconnect() {
        session.clear(true);
      },
      destroy() {
        session.destroy();
      },
    };
  }
  const [{ createAppKit }, { EthersAdapter }] = await loadSdk();
  signal?.throwIfAborted();
  let alive = true;
  let blocked = !!readStored(session.storage, session.key, {}).disconnected;
  let disconnecting = null;
  // AppKit's stock adapter creates an independent public JsonRpcProvider for balances.
  // Route that documented adapter method through the same failover/cooldown pool.
  const network = {
    id: config.chainId,
    name: "Arc",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrls(config, env)[0]] } },
    blockExplorers: { default: { name: "Arc Explorer", url: config.explorer } },
  };
  const cacheKey = JSON.stringify([projectId, config.chainId, config.explorer, network.rpcUrls]);
  const cached = appKitInstance(
    createAppKit,
    cacheKey,
    (context) => {
      class ReadAdapter extends EthersAdapter {
        async getBalance({ address, chainId }) {
          if (!context.rpc || Number(chainId) !== config.chainId)
            return super.getBalance({ address, chainId });
          if (!address) return { balance: "0", symbol: "USDC" };
          const balance = await context.rpc.run((p) => p.getBalance(address), {
            key: `native:${address.toLowerCase()}`,
          });
          return { balance: formatEther(balance), symbol: "USDC" };
        }
      }
      return createAppKit({
        adapters: [new ReadAdapter()],
        networks: [network],
        defaultNetwork: network,
        projectId,
        metadata: {
          name: "Papaya",
          description: "Papaya on Arc",
          url: window.location.origin,
          icons: [],
        },
        enableEIP6963: true,
        enableInjected: true,
        enableWalletConnect: true,
        enableReconnect: !blocked,
        features: {
          analytics: false,
          email: false,
          socials: false,
          swaps: false,
          onramp: false,
        },
        allowUnsupportedChain: true,
      });
    },
    rpc,
  );
  const modal = cached.modal;

  const bind = (providers) => {
    if (!alive || blocked) return;
    const raw = providers.eip155 || null;
    // Raw EIP-1193 account/chain events already rebuild this session.
    if (raw === session.raw) return;
    session.attach(raw).catch(session.onError);
  };
  let offProviders = () => {},
    offAccount = () => {};
  const release = () => {
    if (!alive) return;
    alive = false;
    offProviders();
    offAccount();
    signal?.removeEventListener("abort", release);
    session.destroy();
    if (cached.release === release) cached.release = null;
  };
  cached.release = release;
  signal?.addEventListener("abort", release, { once: true });
  try {
    offProviders = modal.subscribeProviders(bind);
    offAccount = modal.subscribeAccount((state) => {
      if (alive && !blocked && state.status === "disconnected") session.clear(false);
    }, "eip155");
    const raw = modal.getWalletProvider();
    if (raw && !blocked) await session.attach(raw, { restore: true });
    signal?.throwIfAborted();
  } catch (error) {
    release();
    throw error;
  }
  const disconnect = () => {
    blocked = true;
    session.clear(true); // Immediate UI clear, even if SDK cleanup fails or emits late events.
    if (!disconnecting)
      disconnecting = Promise.resolve()
        .then(() => modal.disconnect("eip155"))
        .finally(() => {
          disconnecting = null;
        });
    return disconnecting;
  };
  return {
    async open() {
      if (!alive) return;
      if (blocked) {
        // Clear any SDK-restored session before allowing a new user choice.
        await disconnect();
        if (!alive) return;
        blocked = false;
        // Keep the persisted disconnect marker until a new provider is selected.
      }
      return modal.open({
        view: session.state.account ? "Account" : "Connect",
        namespace: "eip155",
      });
    },
    disconnect,
    destroy: release,
  };
}
