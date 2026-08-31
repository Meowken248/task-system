import { useState, useCallback, useEffect, useRef } from "react";
import { initFiaiSDK, getFiaiSDK } from "../services/blockchain/fiai-sdk.service";
import { resolveMetanodeWalletAddress, promptForMetanodeWalletImport } from "../services/blockchain/metanode-wallet.service";
import { withTimeout, blockchainErrorMessage } from "../services/blockchain/utils";

// ABI Definitions for OffchainDataRegistry
const SET_CID_ABI = {
  type: "function",
  name: "setCID",
  inputs: [
    { internalType: "string", name: "key", type: "string" },
    { internalType: "string", name: "cid", type: "string" }
  ],
  outputs: [],
  stateMutability: "nonpayable"
};

const GET_CID_ABI = {
  type: "function",
  name: "getCID",
  inputs: [
    { internalType: "address", name: "user", type: "address" },
    { internalType: "string", name: "key", type: "string" }
  ],
  outputs: [{ internalType: "string", name: "", type: "string" }],
  stateMutability: "view"
};

export function useOffchainData(key: string) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const contractAddress = process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS || "0x1eF16F9e7Faf6977f8a6d13187A9eD7981b4460B";
  const proxyUrl = process.env.VITE_PINATA_PROXY_URL || "https://your-worker-url.workers.dev";

  // Thử lần lượt các IPFS Gateway thay vì gọi song song
  const fetchFromIPFS = async (cid: string) => {
    const gateways = [
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      `https://ipfs.io/ipfs/${cid}`,
      `https://cloudflare-ipfs.com/ipfs/${cid}`
    ];

    for (const url of gateways) {
      try {
        const response = await fetch(url);
        if (response.ok) return await response.json();
      } catch (err) {
        console.warn(`Gateway ${url} failed, trying next...`);
      }
    }
    throw new Error("Failed to fetch data from all IPFS gateways.");
  };

  const readCIDFromContract = async (userAddress: string) => {
    await initFiaiSDK();
    const { MtnContract } = await import("@metanodejs/mtn-contract");
    const contract = new MtnContract({ from: userAddress, to: contractAddress });

    const result = await withTimeout(
      contract.sendTransaction({
        from: userAddress,
        to: contractAddress,
        abiData: [GET_CID_ABI],
        functionName: "getCID",
        feeType: "read",
        amount: "0",
        value: "0",
        gas: process.env.VITE_CONTRACT_GAS || "3000000",
        type: "transaction",
        inputArray: [
          { ...GET_CID_ABI.inputs[0], value: userAddress },
          { ...GET_CID_ABI.inputs[1], value: key }
        ],
        isReadOnly: true,
        bundleId: "",
      }),
      20_000,
      "Không đọc được CID on-chain sau 20 giây. Vui lòng thử lại."
    );
    return result as string;
  };

  const writeCIDToContract = async (userAddress: string, cid: string) => {
    let bridge = (await initFiaiSDK()) ?? getFiaiSDK();
    if (!bridge) throw new Error("FiaiSDK is not available.");

    const send = () =>
      bridge!.request("sendTransaction", {
        from: userAddress,
        to: contractAddress,
        abiData: [SET_CID_ABI],
        functionName: "setCID",
        feeType: "sc",
        amount: "0",
        value: "0",
        gas: process.env.VITE_CONTRACT_GAS || "3000000",
        type: "transaction",
        inputArray: [
          { ...SET_CID_ABI.inputs[0], value: key },
          { ...SET_CID_ABI.inputs[1], value: cid }
        ],
        isReadOnly: false,
        bundleId: "",
      });

    const sendWithWalletRecovery = async (): Promise<unknown> => {
      try {
        return await send();
      } catch (error) {
        const message = blockchainErrorMessage(error);
        if (!/wallet not found/i.test(message) && !/no frame found/i.test(message)) throw error;
        const imported = await promptForMetanodeWalletImport(userAddress);
        if (!imported)
          throw new Error("Không tìm thấy ví trong Crypto Vault hoặc thao tác kết nối đã hết hạn.", { cause: error });
        return send();
      }
    };

    return await sendWithWalletRecovery();
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const localCache = window.localStorage.getItem(`offchain_${key}`);
      const cachedCID = window.localStorage.getItem(`offchain_cid_${key}`);
      if (localCache && cachedCID) setData(JSON.parse(localCache));

      const userAddress = await resolveMetanodeWalletAddress().catch(() => null);
      if (!userAddress) {
        if (localCache) return;
        throw new Error("Vui lòng kết nối ví để tải dữ liệu.");
      }

      const contractCID = await readCIDFromContract(userAddress);
      
      if (!contractCID || contractCID === "") {
        if (!localCache) setData(null);
        return;
      }

      if (contractCID !== cachedCID) {
        const ipfsData = await fetchFromIPFS(contractCID);
        setData(ipfsData);
        window.localStorage.setItem(`offchain_${key}`, JSON.stringify(ipfsData));
        window.localStorage.setItem(`offchain_cid_${key}`, contractCID);
      }
    } catch (err: any) {
      console.error("useOffchainData load error:", err);
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [key]);

  // Debounce logic
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const rejectPreviousRef = useRef<((reason?: any) => void) | null>(null);

  const save = useCallback((newData: any) => {
    return new Promise<void>((resolve, reject) => {
      // Hủy lần gọi trước đó và reject Promise bị hủy
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        if (rejectPreviousRef.current) {
          rejectPreviousRef.current(new Error("debounced"));
        }
      }
      
      // Lưu hàm reject của lần gọi này để có thể reject sau nếu bị hủy
      rejectPreviousRef.current = reject;
      
      debounceRef.current = setTimeout(async () => {
        setIsLoading(true);
        setError(null);
        try {
          const userAddress = await resolveMetanodeWalletAddress();

          const response = await fetch(proxyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newData)
          });

          if (!response.ok) throw new Error("Failed to upload data to IPFS proxy.");
          const { cid } = await response.json();
          if (!cid) throw new Error("Invalid response from proxy.");

          // 1. Chờ user ký và mạng lưới xác nhận transaction xong xuôi
          await writeCIDToContract(userAddress, cid);

          // 2. Tới lúc này (không bị throw error), mới CẬP NHẬT CACHE LOCAL
          setData(newData);
          window.localStorage.setItem(`offchain_${key}`, JSON.stringify(newData));
          window.localStorage.setItem(`offchain_cid_${key}`, cid);

          resolve();
        } catch (err: any) {
          console.error("useOffchainData save error:", err);
          setError(err);
          reject(err); // Ném lỗi ra ngoài, KHÔNG lưu cache
        } finally {
          setIsLoading(false);
          rejectPreviousRef.current = null;
        }
      }, 1000); // 1 giây debounce
    });
  }, [key, contractAddress, proxyUrl]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, isLoading, error, save, load };
}

export async function migrateFromLocalStorage(key: string) {
  try {
    const rawDataStr = window.localStorage.getItem(key);
    if (!rawDataStr) return false;

    const rawData = JSON.parse(rawDataStr);
    const userAddress = await resolveMetanodeWalletAddress();
    const proxyUrl = process.env.VITE_PINATA_PROXY_URL || "https://your-worker.your-domain.workers.dev";
    const contractAddress = process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS || "0x1eF16F9e7Faf6977f8a6d13187A9eD7981b4460B";

    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rawData)
    });
    
    if (!response.ok) throw new Error("Migration failed at IPFS upload");
    const { cid } = await response.json();
    
    let bridge = (await initFiaiSDK()) ?? getFiaiSDK();
    if (!bridge) throw new Error("FiaiSDK is not available.");

    const send = () =>
      bridge!.request("sendTransaction", {
        from: userAddress,
        to: contractAddress,
        abiData: [SET_CID_ABI],
        functionName: "setCID",
        feeType: "sc",
        amount: "0",
        value: "0",
        gas: process.env.VITE_CONTRACT_GAS || "3000000",
        type: "transaction",
        inputArray: [
          { ...SET_CID_ABI.inputs[0], value: key },
          { ...SET_CID_ABI.inputs[1], value: cid }
        ],
        isReadOnly: false,
        bundleId: "",
      });

    // 1. Chờ transaction on-chain hoàn tất
    await send(); 

    // 2. Chuyển đổi cache và XÓA key cũ
    window.localStorage.setItem(`offchain_${key}`, JSON.stringify(rawData));
    window.localStorage.setItem(`offchain_cid_${key}`, cid);
    window.localStorage.removeItem(key); 

    console.log(`Migration successful for key: ${key}`);
    return true;
  } catch (error) {
    console.error("Migration error:", error);
    return false;
  }
}
