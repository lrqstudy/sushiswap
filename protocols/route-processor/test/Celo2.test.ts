import { ChainId } from '@sushiswap/chain'
import { Native, Token, Type, USDC, WNATIVE } from '@sushiswap/currency'
import { DataFetcher, Router } from '@sushiswap/router'
import { getBigNumber, RouteStatus } from '@sushiswap/tines'
import { expect } from 'chai'
import { BigNumber, Signer } from 'ethers'
import { ethers } from 'hardhat'
import { createPublicClient } from 'viem'
import { http } from 'viem'
import { celo } from 'viem/chains'

//const RouteProcessorAddr = '0x9B3fF703FA9C8B467F5886d7b61E61ba07a9b51c'
const RouteProcessorAddr = '0xf267704dd1393c26b39a6d41f49bea233b34f722' // new Route Processor

const cUSDC = new Token({
  chainId: ChainId.CELO,
  address: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
  decimals: 18,
  symbol: 'cUSD',
  name: 'Celo Dollar',
})

const delay = async (ms: number) => new Promise((res) => setTimeout(res, ms))

async function makeSwap(
  dataFetcher: DataFetcher,
  signer: Signer,
  fromToken: Type,
  toToken: Type,
  from: string,
  to: string,
  amountIn: BigNumber
): Promise<number | undefined> {
  let route, pcMap
  for (let i = 0; i < 100; ++i) {
    pcMap = dataFetcher.getCurrentPoolCodeMap(fromToken, toToken)
    // try to find a route
    route = Router.findBestRoute(pcMap, ChainId.CELO, fromToken, amountIn, toToken, 50e9)
    if (route.status == RouteStatus.Success) break
    await delay(1000)
  }
  expect(route?.status).equal(RouteStatus.Success)

  if (route && pcMap) {
    const rpParams = Router.routeProcessor2Params(pcMap, route, fromToken, toToken, to, RouteProcessorAddr)
    const RouteProcessorFactory = await ethers.getContractFactory('RouteProcessor2', signer)
    const RouteProcessor = RouteProcessorFactory.attach(RouteProcessorAddr)
    const res = await RouteProcessor.callStatic.processRoute(
      rpParams.tokenIn,
      rpParams.amountIn,
      rpParams.tokenOut,
      rpParams.amountOutMin,
      rpParams.to,
      rpParams.routeCode,
      { value: rpParams.value?.toString() }
    )
    // console.log(parseInt(res.toString()))
    return parseInt(res.toString())
  }
}

if (process.env.INFURA_API_KEY) {
  describe.skip('Celo', async () => {
    const chainId = ChainId.CELO

    const provider = new ethers.providers.JsonRpcProvider(
      `https://celo-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      42220
    )

    const client = createPublicClient({
      // chain: {
      //   ...hardhat,
      //   contracts: {
      //     multicall3: {
      //       address: '0xca11bde05977b3631167028862be2a173976ca11',
      //       blockCreated: 25770160,
      //     },
      //   },
      //   pollingInterval: 1_000,
      // },
      //transport: custom(network.provider),
      chain: celo,
      transport: http(`https://celo-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`),
    })

    const dataFetcher = new DataFetcher(chainId, client)
    dataFetcher.startDataFetching()

    it('CELO => USDC', async () => {
      const signer = await provider.getUncheckedSigner(WNATIVE[chainId].address)
      await makeSwap(
        dataFetcher,
        signer,
        Native.onChain(chainId),
        USDC[chainId],
        WNATIVE[chainId].address,
        WNATIVE[chainId].address,
        getBigNumber(10 * 1e18)
      )
    })

    it('cUSDC => CELO', async () => {
      const user = '0xed30404098da5948d8B3cBD7958ceB641F2C352c' // has cUSDC and approved 800000 to the RP
      const signer = await provider.getUncheckedSigner(user)
      await makeSwap(dataFetcher, signer, cUSDC, Native.onChain(chainId), user, user, getBigNumber(800000))
    })
  })
}
