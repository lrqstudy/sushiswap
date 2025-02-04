import { Provider } from '@ethersproject/providers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { erc20Abi, weth9Abi } from '@sushiswap/abi'
import { bentoBoxV1Address, BentoBoxV1ChainId } from '@sushiswap/bentobox'
import { ChainId, chainName } from '@sushiswap/chain'
import {
  DAI,
  DAI_ADDRESS,
  FRAX,
  FRAX_ADDRESS,
  FXS,
  FXS_ADDRESS,
  Native,
  SUSHI,
  SUSHI_ADDRESS,
  Token,
  Type,
  USDC,
  USDC_ADDRESS,
  USDT,
  USDT_ADDRESS,
  WNATIVE,
} from '@sushiswap/currency'
import { DataFetcher, LiquidityProviders, PoolFilter, Router } from '@sushiswap/router'
import { PoolCode } from '@sushiswap/router/dist/pools/PoolCode'
import {
  BridgeBento,
  BridgeUnlimited,
  ConstantProductRPool,
  getBigNumber,
  RPool,
  StableSwapRPool,
  toShareBN,
} from '@sushiswap/tines'
import { expect } from 'chai'
import { BigNumber, Contract } from 'ethers'
import { ethers, network } from 'hardhat'
import seedrandom from 'seedrandom'
import { createPublicClient } from 'viem'
import { custom } from 'viem'
import { hardhat } from 'viem/chains'

function getRandomExp(rnd: () => number, min: number, max: number) {
  const minL = Math.log(min)
  const maxL = Math.log(max)
  const v = rnd() * (maxL - minL) + minL
  const res = Math.exp(v)
  console.assert(res <= max && res >= min, 'Random value is out of the range')
  return res
}

const delay = async (ms: number) => new Promise((res) => setTimeout(res, ms))

function closeValues(_a: number | BigNumber, _b: number | BigNumber, accuracy: number, absolute: number): boolean {
  const a: number = typeof _a == 'number' ? _a : parseInt(_a.toString())
  const b: number = typeof _b == 'number' ? _b : parseInt(_b.toString())
  if (accuracy === 0) return a === b
  if (Math.abs(a - b) < absolute) return true
  // if (Math.abs(a) < 1 / accuracy) return Math.abs(a - b) <= 10
  // if (Math.abs(b) < 1 / accuracy) return Math.abs(a - b) <= 10
  return Math.abs(a / b - 1) < accuracy
}

function expectCloseValues(
  _a: number | BigNumber,
  _b: number | BigNumber,
  accuracy: number,
  absolute: number,
  logInfoIfFalse = ''
) {
  const res = closeValues(_a, _b, accuracy, absolute)
  if (!res) {
    console.log(`Expected close: ${_a}, ${_b}, ${accuracy} ${logInfoIfFalse}`)
    // debugger
    expect(res).equal(true)
  }
  return res
}

export async function checkPoolsState(pools: Map<string, PoolCode>, env: TestEnvironment) {
  const bentoAddress = bentoBoxV1Address[env.chainId as BentoBoxV1ChainId]
  const bentoContract = new Contract(
    bentoAddress,
    ['function totals(address) view returns (uint128, uint128)'],
    env.user
  )

  const addresses = Array.from(pools.keys())
  for (let i = 0; i < addresses.length; ++i) {
    const addr = addresses[i]
    const pool = (pools.get(addr) as PoolCode).pool
    if (pool instanceof StableSwapRPool) {
      const poolContract = new Contract(addr, ['function getReserves() view returns (uint256, uint256)'], env.user)

      const totals0 = await bentoContract.totals(pool.token0.address)
      const token0 = pool.token0.symbol
      expectCloseValues(pool.getTotal0().elastic, totals0[0], 1e-10, 10, `StableSwapRPool ${addr} ${token0}.elastic`)
      expectCloseValues(pool.getTotal0().base, totals0[1], 1e-10, 10, `StableSwapRPool ${addr} ${token0}.base`)

      const totals1 = await bentoContract.totals(pool.token1.address)
      const token1 = pool.token1.symbol
      expectCloseValues(pool.getTotal1().elastic, totals1[0], 1e-10, 10, `StableSwapRPool ${addr} ${token1}.elastic`)
      expectCloseValues(pool.getTotal1().base, totals1[1], 1e-10, 10, `StableSwapRPool ${addr} ${token1}.base`)

      const reserves = await poolContract.getReserves()
      expectCloseValues(
        pool.getReserve0(),
        toShareBN(reserves[0], pool.getTotal0()),
        1e-10,
        1e6,
        `StableSwapRPool ${addr} reserve0`
      )
      expectCloseValues(
        pool.getReserve1(),
        toShareBN(reserves[1], pool.getTotal1()),
        1e-10,
        1e6,
        `StableSwapRPool ${addr} reserve1`
      )
    } else if (pool instanceof ConstantProductRPool) {
      const poolContract = new Contract(addr, ['function getReserves() view returns (uint112, uint112)'], env.user)
      const reserves = await poolContract.getReserves()
      expectCloseValues(pool.getReserve0(), reserves[0], 1e-10, 10, `CP ${addr} reserve0`)
      expectCloseValues(pool.getReserve1(), reserves[1], 1e-10, 10, `CP ${addr} reserve1`)
    } else if (pool instanceof BridgeBento) {
      const totals = await bentoContract.totals(pool.token1.address)
      expectCloseValues(pool.elastic, totals[0], 1e-10, 10, `BentoBridge ${pool.token1.symbol} elastic`)
      expectCloseValues(pool.base, totals[1], 1e-10, 10, `BentoBridge ${pool.token1.symbol} base`)
    } else if (pool instanceof BridgeUnlimited) {
      // native - skip
    } else {
      console.log('Unknown pool: ', pool)
    }
  }
}

interface TestEnvironment {
  chainId: ChainId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provider: any
  rp: Contract
  user: SignerWithAddress
  user2: SignerWithAddress
  dataFetcher: DataFetcher
}

async function getTestEnvironment(): Promise<TestEnvironment> {
  //console.log('Prepare Environment:')

  const client = createPublicClient({
    chain: {
      ...hardhat,
      contracts: {
        multicall3: {
          address: '0xca11bde05977b3631167028862be2a173976ca11',
          blockCreated: 25770160,
        },
      },
      pollingInterval: 1_000,
    },
    transport: custom(network.provider),
  })
  //console.log('    Create DataFetcher ...')
  const provider = ethers.provider
  const chainId = network.config.chainId as ChainId
  const dataFetcher = new DataFetcher(chainId, client)

  //console.log({ chainId, url: ethers.provider.connection.url, otherurl: network.config.forking.url })

  dataFetcher.startDataFetching()

  console.log(`    ChainId=${chainId} RouteProcessor deployment (may take long time for the first launch)...`)
  const RouteProcessor = await ethers.getContractFactory('RouteProcessor2')
  const routeProcessor = await RouteProcessor.deploy(bentoBoxV1Address[chainId as BentoBoxV1ChainId])
  await routeProcessor.deployed()
  //console.log('    Block Number:', provider.blockNumber)

  console.log(`Network: ${chainName[chainId]}, Forked Block: ${provider.blockNumber}`)
  //console.log('    User creation ...')
  const [Alice, Bob] = await ethers.getSigners()

  return {
    chainId,
    provider,
    rp: routeProcessor,
    user: Alice,
    user2: Bob,
    dataFetcher,
  }
}

// all pool data assumed to be updated
async function makeSwap(
  env: TestEnvironment,
  fromToken: Type,
  amountIn: BigNumber,
  toToken: Type,
  providers?: LiquidityProviders[],
  poolFilter?: PoolFilter,
  makeSankeyDiagram = false
): Promise<[BigNumber, number] | undefined> {
  //console.log(`Make swap ${fromToken.symbol} -> ${toToken.symbol} amount: ${amountIn.toString()}`)

  if (fromToken instanceof Token) {
    //console.log(`Approve user's ${fromToken.symbol} to the route processor ...`)
    const WrappedBaseTokenContract = new ethers.Contract(fromToken.address, erc20Abi, env.user)
    await WrappedBaseTokenContract.connect(env.user).approve(env.rp.address, amountIn)
  }

  //console.log('Create Route ...')
  await env.dataFetcher.fetchPoolsForToken(fromToken, toToken)

  const pcMap = env.dataFetcher.getCurrentPoolCodeMap(fromToken, toToken)

  await checkPoolsState(pcMap, env)

  const route = Router.findBestRoute(pcMap, env.chainId, fromToken, amountIn, toToken, 30e9, providers, poolFilter)
  // console.log(Router.routeToHumanString(pcMap, route, fromToken, toToken))
  // console.log(
  //   'ROUTE:',
  //   route.legs.map(
  //     (l) =>
  //       l.tokenFrom.symbol +
  //       ' -> ' +
  //       l.tokenTo.symbol +
  //       '  ' +
  //       l.poolAddress +
  //       '  ' +
  //       l.assumedAmountIn +
  //       ' ->' +
  //       l.assumedAmountOut
  //   )
  // )
  const rpParams = Router.routeProcessor2Params(pcMap, route, fromToken, toToken, env.user.address, env.rp.address)
  if (rpParams === undefined) return

  //console.log('Call route processor (may take long time for the first launch)...')

  let balanceOutBNBefore: BigNumber
  let toTokenContract: Contract | undefined = undefined
  if (toToken instanceof Token) {
    toTokenContract = await new ethers.Contract(toToken.address, weth9Abi, env.user)
    balanceOutBNBefore = await toTokenContract.connect(env.user).balanceOf(env.user.address)
  } else {
    balanceOutBNBefore = await env.user.getBalance()
  }
  let tx
  if (rpParams.value)
    tx = await env.rp.processRoute(
      rpParams.tokenIn,
      rpParams.amountIn,
      rpParams.tokenOut,
      rpParams.amountOutMin,
      rpParams.to,
      rpParams.routeCode,
      { value: rpParams.value }
    )
  else
    tx = await env.rp.processRoute(
      rpParams.tokenIn,
      rpParams.amountIn,
      rpParams.tokenOut,
      rpParams.amountOutMin,
      rpParams.to,
      rpParams.routeCode
    )
  const receipt = await tx.wait()

  // const trace = await network.provider.send('debug_traceTransaction', [receipt.transactionHash])
  // printGasUsage(trace)

  //console.log("Fetching user's output balance ...")
  let balanceOutBN: BigNumber
  if (toTokenContract) {
    balanceOutBN = (await toTokenContract.connect(env.user).balanceOf(env.user.address)).sub(balanceOutBNBefore)
  } else {
    balanceOutBN = (await env.user.getBalance()).sub(balanceOutBNBefore)
    balanceOutBN = balanceOutBN.add(receipt.effectiveGasPrice.mul(receipt.gasUsed))
  }
  const slippage = parseInt(balanceOutBN.sub(route.amountOutBN).mul(10_000).div(route.amountOutBN).toString())

  if (route.amountOutBN.sub(balanceOutBN).abs().gt(10)) {
    if (slippage < 0) {
      console.log(`expected amountOut: ${route.amountOutBN.toString()}`)
      console.log(`real amountOut:     ${balanceOutBN.toString()}`)
      console.log(`slippage: ${slippage / 100}%`)
    }
    expect(slippage).greaterThanOrEqual(0) // positive slippage could be if we 'gather' some liquidity on the route
  }

  return [balanceOutBN, receipt.blockNumber]
}

async function dataUpdated(env: TestEnvironment, minBlockNumber: number) {
  for (;;) {
    if (env.dataFetcher.getLastUpdateBlock() >= minBlockNumber) return
    await delay(500)
  }
}

async function updMakeSwap(
  env: TestEnvironment,
  fromToken: Type,
  toToken: Type,
  lastCallResult: BigNumber | [BigNumber | undefined, number],
  providers?: LiquidityProviders[],
  poolFilter?: PoolFilter,
  makeSankeyDiagram = false
): Promise<[BigNumber | undefined, number]> {
  const [amountIn, waitBlock] = lastCallResult instanceof BigNumber ? [lastCallResult, 1] : lastCallResult
  if (amountIn === undefined) return [undefined, waitBlock] // previous swap failed

  //console.log('Wait data update for min block', waitBlock)
  await dataUpdated(env, waitBlock)

  const res = await makeSwap(env, fromToken, amountIn, toToken, providers, poolFilter, makeSankeyDiagram)
  expect(res).not.undefined
  if (res === undefined) return [undefined, waitBlock]
  else return res
}

async function checkTransferAndRoute(
  env: TestEnvironment,
  fromToken: Type,
  toToken: Type,
  lastCallResult: BigNumber | [BigNumber | undefined, number]
): Promise<[BigNumber | undefined, number]> {
  const [amountIn, waitBlock] = lastCallResult instanceof BigNumber ? [lastCallResult, 1] : lastCallResult
  if (amountIn === undefined) return [undefined, waitBlock] // previous swap failed
  await dataUpdated(env, waitBlock)

  if (fromToken instanceof Token) {
    const WrappedBaseTokenContract = await new ethers.Contract(fromToken.address, erc20Abi, env.user)
    await WrappedBaseTokenContract.connect(env.user).approve(env.rp.address, amountIn)
  }

  await env.dataFetcher.fetchPoolsForToken(fromToken, toToken)

  const pcMap = env.dataFetcher.getCurrentPoolCodeMap(fromToken, toToken)
  const route = Router.findBestRoute(pcMap, env.chainId, fromToken, amountIn, toToken, 30e9)
  const rpParams = Router.routeProcessor2Params(pcMap, route, fromToken, toToken, env.user.address, env.rp.address)
  const transferValue = getBigNumber(0.02 * Math.pow(10, Native.onChain(env.chainId).decimals))
  rpParams.value = (rpParams.value || BigNumber.from(0)).add(transferValue)

  const balanceUser2Before = await env.user2.getBalance()

  let balanceOutBNBefore: BigNumber
  let toTokenContract: Contract | undefined = undefined
  if (toToken instanceof Token) {
    toTokenContract = await new ethers.Contract(toToken.address, weth9Abi, env.user)
    balanceOutBNBefore = await toTokenContract.connect(env.user).balanceOf(env.user.address)
  } else {
    balanceOutBNBefore = await env.user.getBalance()
  }
  const tx = await env.rp.transferValueAndprocessRoute(
    env.user2.address,
    transferValue,
    rpParams.tokenIn,
    rpParams.amountIn,
    rpParams.tokenOut,
    rpParams.amountOutMin,
    rpParams.to,
    rpParams.routeCode,
    { value: rpParams.value }
  )
  const receipt = await tx.wait()

  let balanceOutBN: BigNumber
  if (toTokenContract) {
    balanceOutBN = (await toTokenContract.connect(env.user).balanceOf(env.user.address)).sub(balanceOutBNBefore)
  } else {
    balanceOutBN = (await env.user.getBalance()).sub(balanceOutBNBefore)
    balanceOutBN = balanceOutBN.add(receipt.effectiveGasPrice.mul(receipt.gasUsed))
    balanceOutBN = balanceOutBN.add(transferValue)
  }
  expect(balanceOutBN.gte(rpParams.amountOutMin)).equal(true)

  const balanceUser2After = await env.user2.getBalance()
  const transferredValue = balanceUser2After.sub(balanceUser2Before)
  expect(transferredValue.eq(transferValue)).equal(true)

  return [balanceOutBN, receipt.blockNumber]
}

// skipped because took too long time. Unskip to check the RP
describe('End-to-end Router2 test', async function () {
  let env: TestEnvironment
  let chainId: ChainId
  let intermidiateResult: [BigNumber | undefined, number] = [undefined, 1]
  let testTokensSet: (Type | undefined)[]
  let SUSHI_LOCAL: Token
  let USDC_LOCAL: Token

  before(async () => {
    env = await getTestEnvironment()
    chainId = env.chainId

    type SUSHI_CHAINS = keyof typeof SUSHI_ADDRESS
    type USDC_CHAINS = keyof typeof USDC_ADDRESS
    type USDT_CHAINS = keyof typeof USDT_ADDRESS
    type DAI_CHAINS = keyof typeof DAI_ADDRESS
    type FRAX_CHAINS = keyof typeof FRAX_ADDRESS
    type FXS_CHAINS = keyof typeof FXS_ADDRESS
    SUSHI_LOCAL = SUSHI[chainId as SUSHI_CHAINS]
    USDC_LOCAL = USDC[chainId as USDC_CHAINS]
    testTokensSet = [
      Native.onChain(chainId),
      WNATIVE[chainId],
      SUSHI[chainId as SUSHI_CHAINS],
      USDC[chainId as USDC_CHAINS],
      USDT[chainId as USDT_CHAINS],
      DAI[chainId as DAI_CHAINS],
      FRAX[chainId as FRAX_CHAINS],
      FXS[chainId as FXS_CHAINS],
    ]
  })

  it('Native => SUSHI => Native', async function () {
    intermidiateResult[0] = getBigNumber(1000000 * 1e18)
    intermidiateResult = await updMakeSwap(env, Native.onChain(chainId), SUSHI_LOCAL, intermidiateResult)
    intermidiateResult = await updMakeSwap(env, SUSHI_LOCAL, Native.onChain(chainId), intermidiateResult)
  })

  it('Native => WrappedNative => Native', async function () {
    intermidiateResult[0] = getBigNumber(1 * 1e18)
    intermidiateResult = await updMakeSwap(env, Native.onChain(chainId), WNATIVE[chainId], intermidiateResult)
    intermidiateResult = await updMakeSwap(env, WNATIVE[chainId], Native.onChain(chainId), intermidiateResult)
  })

  it('Trident Native => SUSHI => Native (Polygon only)', async function () {
    if (chainId == ChainId.POLYGON) {
      intermidiateResult[0] = getBigNumber(10_000 * 1e18)
      intermidiateResult = await updMakeSwap(env, Native.onChain(chainId), SUSHI[chainId], intermidiateResult, [
        LiquidityProviders.Trident,
      ])
      intermidiateResult = await updMakeSwap(env, SUSHI[chainId], Native.onChain(chainId), intermidiateResult, [
        LiquidityProviders.Trident,
      ])
    }
  })

  it('StablePool Native => USDC => USDT => DAI => USDC (Polygon only)', async function () {
    const filter = (pool: RPool) => pool instanceof StableSwapRPool || pool instanceof BridgeBento

    if (chainId == ChainId.POLYGON) {
      intermidiateResult[0] = getBigNumber(10_000 * 1e18)
      intermidiateResult = await updMakeSwap(env, Native.onChain(chainId), USDC[chainId], intermidiateResult)
      intermidiateResult = await updMakeSwap(env, USDC[chainId], USDT[chainId], intermidiateResult, undefined, filter)
      intermidiateResult = await updMakeSwap(env, USDT[chainId], DAI[chainId], intermidiateResult, undefined, filter)
      intermidiateResult = await updMakeSwap(env, DAI[chainId], USDC[chainId], intermidiateResult, undefined, filter)
    }
  })

  function getNextToken(rnd: () => number, previousTokenIndex: number): number {
    for (;;) {
      const next = Math.floor(rnd() * testTokensSet.length)
      if (next == previousTokenIndex) continue
      if (testTokensSet[next] === undefined) continue
      return next
    }
  }

  it.skip('Random swap test', async function () {
    let routeCounter = 0
    for (let i = 0; i < 100; ++i) {
      let currentToken = 0
      const rnd: () => number = seedrandom('testSeed ' + i) // random [0, 1)
      intermidiateResult[0] = getBigNumber(getRandomExp(rnd, 1e15, 1e24))
      for (;;) {
        const nextToken = getNextToken(rnd, currentToken)
        console.log('Round # ', i + 1, ' Total Route # ', ++routeCounter)
        intermidiateResult = await updMakeSwap(
          env,
          testTokensSet[currentToken] as Type,
          testTokensSet[nextToken] as Type,
          intermidiateResult
        )
        currentToken = nextToken
        if (currentToken == 0) break
      }
    }
  })

  it('Special Router', async function () {
    await env.dataFetcher.fetchPoolsForToken(Native.onChain(chainId), SUSHI_LOCAL)

    const pcMap = env.dataFetcher.getCurrentPoolCodeMap(Native.onChain(chainId), SUSHI_LOCAL)

    const route = Router.findSpecialRoute(
      pcMap,
      chainId,
      Native.onChain(chainId),
      getBigNumber(1 * 1e18),
      SUSHI_LOCAL,
      30e9
    )
    expect(route).not.undefined
  })

  if (network.config.chainId == ChainId.POLYGON) {
    it('Transfer value and route 1', async function () {
      intermidiateResult[0] = getBigNumber(1e18)
      intermidiateResult = await checkTransferAndRoute(env, Native.onChain(chainId), SUSHI_LOCAL, intermidiateResult)
      intermidiateResult = await checkTransferAndRoute(env, SUSHI_LOCAL, USDC_LOCAL, intermidiateResult)
      intermidiateResult = await checkTransferAndRoute(env, USDC_LOCAL, Native.onChain(chainId), intermidiateResult)
    })

    it('Transfer value and route 2', async function () {
      intermidiateResult[0] = getBigNumber(1e18)
      intermidiateResult = await checkTransferAndRoute(
        env,
        Native.onChain(chainId),
        WNATIVE[chainId],
        intermidiateResult
      )
      intermidiateResult = await checkTransferAndRoute(env, WNATIVE[chainId], SUSHI_LOCAL, intermidiateResult)
      intermidiateResult = await checkTransferAndRoute(env, SUSHI_LOCAL, WNATIVE[chainId], intermidiateResult)
      intermidiateResult = await checkTransferAndRoute(
        env,
        WNATIVE[chainId],
        Native.onChain(chainId),
        intermidiateResult
      )
    })

    it('Transfer value and route 3 - check EOA', async function () {
      intermidiateResult[0] = getBigNumber(1e18)
      env.user2 = await ethers.getSigner('0x0000000000000000000000000000000000000001')
      intermidiateResult = await checkTransferAndRoute(env, Native.onChain(chainId), SUSHI_LOCAL, intermidiateResult)
      intermidiateResult = await checkTransferAndRoute(env, SUSHI_LOCAL, USDC_LOCAL, intermidiateResult)
      intermidiateResult = await checkTransferAndRoute(env, USDC_LOCAL, Native.onChain(chainId), intermidiateResult)
    })

    it('Transfer value and route 4 - not payable address', async function () {
      intermidiateResult[0] = getBigNumber(1e18)
      env.user2 = await ethers.getSigner('0x597A9bc3b24C2A578CCb3aa2c2C62C39427c6a49')
      let throwed = false
      try {
        await checkTransferAndRoute(env, Native.onChain(chainId), SUSHI_LOCAL, intermidiateResult)
      } catch (e) {
        throwed = true
      }
      expect(throwed, 'Transfer value to not payable address should fail').equal(true)
    })
  }
})
