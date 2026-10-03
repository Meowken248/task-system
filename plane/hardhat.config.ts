import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    sequoia: {
      url: process.env.VITE_RPC_URL || process.env.RPC_URL || "http://192.168.1.231:10747",
      chainId: 991,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : process.env.VITE_BLS_PRIVATE_KEY
        ? [process.env.VITE_BLS_PRIVATE_KEY]
        : [],
    },
  },
};

export default config;
