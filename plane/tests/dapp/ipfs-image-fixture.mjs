const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function imageIpfsFixture() {
  const files = new Map();
  const byContent = new Map();
  const state = { failUpload: false, badGateway: false, requests: [], files };
  Object.assign(process.env, { VITE_PINATA_PROXY_URL: "https://media.fixture/", VITE_IPFS_GATEWAYS: "https://image-gateway.fixture/ipfs/", VITE_AUTO_COMMIT_ONCHAIN: "false" });
  state.fetch = async (url, options = {}) => {
    if (url === "https://media.fixture/" && options.method === "POST" && options.body instanceof FormData) {
      if (state.failUpload) return Response.json({ code: "STORAGE_TEMPORARY" }, { status: 503 });
      const file = options.body.get("file");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const key = Buffer.from(bytes).toString("base64");
      const cid = byContent.get(key) || "Qm" + alphabet[files.size + 1].repeat(44);
      byContent.set(key, cid);
      files.set(cid, { bytes, type: file.type });
      state.requests.push({ cid, size: file.size, type: file.type });
      return Response.json({ cid });
    }
    if (String(url).startsWith("https://image-gateway.fixture/ipfs/")) {
      const file = files.get(String(url).split("/").pop());
      if (!file) return new Response("missing", { status: 404 });
      return new Response(state.badGateway ? "not an image" : file.bytes, { headers: { "Content-Type": state.badGateway ? "text/html" : file.type } });
    }
    throw new Error("Unexpected fixture network request");
  };
  return state;
}
