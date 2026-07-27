import { useEffect } from "react";
import { observer } from "mobx-react";
import { useUser } from "@/hooks/store/user";
import { initFiaiSDK } from "@/services/blockchain/fiai-sdk.service";
import { configureMetanodeWalletUser, preloadMetanodeWallet } from "@/services/blockchain/metanode-wallet.service";

export const MetanodeBootstrap = observer(function MetanodeBootstrap() {
  const { data: currentUser } = useUser();

  useEffect(() => {
    configureMetanodeWalletUser(currentUser?.id, currentUser?.metanode_wallet_address);
  }, [currentUser?.id, currentUser?.metanode_wallet_address]);

  useEffect(() => {
    const bootstrap = async () => {
      await initFiaiSDK();
      await preloadMetanodeWallet();
    };

    void bootstrap();
  }, []);

  return null;
});
