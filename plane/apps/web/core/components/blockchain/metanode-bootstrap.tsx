import { useEffect } from "react";
import { initFiaiSDK } from "@/services/blockchain/fiai-sdk.service";
import { preloadMetanodeWallet } from "@/services/blockchain/metanode-wallet.service";

export function MetanodeBootstrap() {
  useEffect(() => {
    const bootstrap = async () => {
      await initFiaiSDK();
      await preloadMetanodeWallet();
    };

    void bootstrap();
  }, []);

  return null;
}
