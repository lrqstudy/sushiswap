import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'

import { defaultConfig } from '@sushiswap/hardhat-config'
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from 'hardhat/builtin-tasks/task-names'
import { HardhatUserConfig, subtask } from 'hardhat/config'
import path from 'path'

const accounts = {
  mnemonic: process.env.MNEMONIC || 'test test test test test test test test test test test junk',
  accountsBalance: '10000000000000000000000000',
}

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async ({ solcVersion }: { solcVersion: string }, hre, runSuper) => {
  if (solcVersion === '0.8.10') {
    const compilerPath = path.join(__dirname, 'soljson-v0.8.10+commit.fc410830.js')
    return {
      compilerPath,
      isSolcJs: true, // if you are using a native compiler, set this to false
      version: solcVersion,
      // this is used as extra information in the build-info files, but other than
      // that is not important
      longVersion: '0.8.10+commit.fc410830',
    }
  } else if (solcVersion === '0.6.12') {
    const compilerPath = path.join(__dirname, 'soljson-v0.6.12+commit.27d51765.js')
    return {
      compilerPath,
      isSolcJs: true, // if you are using a native compiler, set this to false
      version: solcVersion,
      // this is used as extra information in the build-info files, but other than
      // that is not important
      longVersion: '0.6.12+commit.27d51765',
    }
  }
  // we just use the default subtask if the version is not 0.8.5
  return runSuper()
})

const config: HardhatUserConfig = {
  ...defaultConfig,
  defaultNetwork: 'hardhat',
  networks: {
    localhost: {},
    hardhat: {
      forking: {
        enabled: true,
        //url: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
        //blockNumber: 34445477,
        url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
      },
      accounts,
    },
  },
  solidity: {
    compilers: [
      {
        version: '0.8.10',
        settings: {
          optimizer: {
            enabled: true,
            runs: 999999,
          },
        },
      },
      {
        version: '0.6.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 999999,
          },
        },
      },
    ],
  },
  mocha: {
    timeout: 3600_000,
  },
}

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
export default config