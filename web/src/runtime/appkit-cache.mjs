// AppKit's HTML factory creates a new adapter/controller tree on every call and
// exposes no destroy API. Keep one instance per factory/config, including HMR.
const instances = import.meta.hot?.data.appKitInstances || new WeakMap();
if (import.meta.hot)
  import.meta.hot.dispose((data) => {
    data.appKitInstances = instances;
  });
export function appKitInstance(factory, key, create, rpc) {
  let configs = instances.get(factory);
  if (!configs) {
    configs = new Map();
    instances.set(factory, configs);
  }
  let entry = configs.get(key);
  if (!entry) {
    const context = { rpc };
    entry = { modal: create(context), context, release: null };
    configs.set(key, entry);
  }
  // A replacement runtime owns SDK subscriptions; the previous one is detached.
  entry.release?.();
  entry.context.rpc = rpc;
  return entry;
}
