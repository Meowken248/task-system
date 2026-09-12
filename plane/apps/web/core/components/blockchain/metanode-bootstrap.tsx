import { useEffect } from "react";
import { observer } from "mobx-react";
import { useUser } from "@/hooks/store/user";
import { configureMetanodeWalletUser } from "@/services/blockchain/metanode-wallet.service";

export const MetanodeBootstrap = observer(function MetanodeBootstrap() {
  const { data: currentUser } = useUser();

  useEffect(() => {
    configureMetanodeWalletUser(currentUser?.id, currentUser?.metanode_wallet_address);
  }, [currentUser?.id, currentUser?.metanode_wallet_address]);

  useEffect(() => {
    // Defer Bridge iframe init — don't block page load with heavy wasm/manifest downloads
    const timer = setTimeout(async () => {
      const { initFiaiSDK } = await import("@/services/blockchain/fiai-sdk.service");
      const { preloadMetanodeWallet } = await import("@/services/blockchain/metanode-wallet.service");
      await initFiaiSDK();
      await preloadMetanodeWallet();
    }, 5000); // Load Bridge 5s after page render

    return () => clearTimeout(timer);
  }, []);

  return null;
});
