const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
};
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();
globalThis.BroadcastChannel = undefined;
globalThis.document = { cookie: "" };
globalThis.window = {
  localStorage,
  sessionStorage,
  location: { hostname: "localhost", origin: "http://localhost:3000", search: "", pathname: "/", port: "3000" },
  addEventListener() {},
  dispatchEvent() {},
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
// Background autosave may remain scheduled after a test. It must not keep the
// runner alive or make a real network call. Every fetch is mocked by a test.
const nativeTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...args) => {
  const timer = nativeTimeout(...args);
  if (Number(args[1]) >= 1000) timer.unref();
  return timer;
};
globalThis.fetch = async () => {
  throw new Error("Unmocked fetch in regression test");
};
