export const scopeKey = (config, account = "") =>
  `${config.chainId}:${config.papaya.toLowerCase()}:${account.toLowerCase()}`;
export function readStored(storage, key, fallback) {
  try {
    return JSON.parse(storage?.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeStored(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
