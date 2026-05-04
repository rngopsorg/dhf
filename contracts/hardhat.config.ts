import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox-viem';

const PK = process.env.OPERATOR_PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: { sources: './src', tests: './test', artifacts: './artifacts', cache: './cache' },
  networks: {
    hardhat: { chainId: 31337 },
    cortex: {
      url: process.env.CORTEX_RPC ?? 'http://cortex-evm:8545',
      chainId: Number(process.env.CORTEX_CHAIN_ID ?? 131072),
      accounts: [PK],
    },
  },
};
export default config;
