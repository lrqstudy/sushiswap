'use client'

import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { Chain, chainName } from '@sushiswap/chain'
import { shortenAddress } from '@sushiswap/format'
import { Currency } from '@sushiswap/ui/future/components/currency'
import { Dialog } from '@sushiswap/ui/future/components/dialog'
import { List } from '@sushiswap/ui/future/components/list/List'
import React, { FC, useCallback } from 'react'

import { useSwapActions, useSwapState } from './TradeProvider'
import { useTrade } from '../../lib/useTrade'
import { Button } from '@sushiswap/ui/future/components/button'
import { Dots } from '@sushiswap/ui/future/components/Dots'
import { Skeleton } from '@sushiswap/ui/future/components/skeleton'
import { Badge } from '@sushiswap/ui/future/components/Badge'
import { Collapsible, NetworkIcon } from '@sushiswap/ui'
import { ConfirmationDialogCrossChain } from '../ConfirmationDialogCrossChain/ConfirmationDialogCrossChain'
import { warningSeverity } from '../../lib/warningSeverity'
import { ZERO } from '@sushiswap/math'
import { useSlippageTolerance } from '@sushiswap/hooks'

export const TradeReviewDialogCrossChain: FC = () => {
  const { review, token0, token1, recipient, network0, network1, amount, value } = useSwapState()
  const { setReview } = useSwapActions()
  const [slippageTolerance] = useSlippageTolerance()
  const { data: trade, isFetching } = useTrade({ crossChain: true })

  const onClose = useCallback(() => setReview(false), [setReview])

  // Don't unmount this dialog since that will slow down the opening callback
  return (
    <Dialog open={review} unmount={false} onClose={onClose} variant="opaque">
      <div className="max-w-[504px] mx-auto">
        <button onClick={onClose} className="pl-0 p-3">
          <ArrowLeftIcon strokeWidth={3} width={24} height={24} />
        </button>
        <div className="flex justify-between gap-4 items-start py-2">
          <div className="flex flex-col flex-grow gap-1">
            {isFetching ? (
              <Skeleton.Text fontSize="text-3xl" className="w-2/3" />
            ) : (
              <h1 className="text-3xl font-semibold dark:text-slate-50">
                Receive {trade?.amountOut?.toSignificant(6)} {token1?.symbol}
              </h1>
            )}
            <h1 className="text-lg font-medium text-gray-900 dark:text-slate-300">
              Swap {amount?.toSignificant(6)} {token0?.symbol}
            </h1>
          </div>
          <div className="min-w-[56px] min-h-[56px]">
            <div className="pr-1">
              <Badge
                position="bottom-right"
                badgeContent={
                  <div className="bg-gray-100 rounded-full border-2 border-gray-100 dark:border-slate-500">
                    <NetworkIcon width={24} height={24} chainId={network1} />
                  </div>
                }
              >
                {token1 ? (
                  <Currency.Icon currency={token1} width={56} height={56} />
                ) : (
                  <Skeleton.Circle radius={56} className="dark:bg-slate-800 bg-gray-100" />
                )}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <List>
            <List.Control>
              <List.KeyValue title="Network">
                <div className="w-full justify-end gap-1 whitespace-nowrap truncate">
                  {chainName?.[network0]?.replace('Mainnet Shard 0', '')?.replace('Mainnet', '')?.trim()}
                  <br />
                  <span className="text-gray-400 dark:text-slate-500">to</span>{' '}
                  {chainName?.[network1]?.replace('Mainnet Shard 0', '')?.replace('Mainnet', '')?.trim()}
                </div>
              </List.KeyValue>
              <List.KeyValue
                title="Price impact"
                subtitle="The impact your trade has on the market price of this pool."
              >
                {isFetching ? (
                  <Skeleton.Text align="right" fontSize="text-sm" className="w-1/5" />
                ) : (
                  `${trade?.priceImpact?.lessThan(ZERO) ? '+' : '-'}${Math.abs(
                    Number(trade?.priceImpact?.toFixed(2))
                  )}%`
                )}
              </List.KeyValue>
              <List.KeyValue
                title={`Min. received after slippage (${slippageTolerance === 'AUTO' ? '0.5' : slippageTolerance}%)`}
                subtitle="The minimum amount you are guaranteed to receive."
              >
                {isFetching ? (
                  <Skeleton.Text align="right" fontSize="text-sm" className="w-1/2" />
                ) : (
                  `${trade?.minAmountOut?.toSignificant(6)} ${token1?.symbol}`
                )}
              </List.KeyValue>
              <List.KeyValue title="Network fee">
                {isFetching ? (
                  <Skeleton.Text align="right" fontSize="text-sm" className="w-1/3" />
                ) : (
                  `~$${trade?.gasSpent ?? '0.00'}`
                )}
              </List.KeyValue>
            </List.Control>
          </List>
          {recipient && (
            <List className="!pt-2">
              <List.Control>
                <List.KeyValue title="Recipient">
                  <a
                    target="_blank"
                    href={Chain.accountUrl(network0, recipient) ?? '#'}
                    className="flex gap-2 items-center text-blue cursor-pointer"
                    rel="noreferrer"
                  >
                    {shortenAddress(recipient)}
                  </a>
                </List.KeyValue>
              </List.Control>
            </List>
          )}
        </div>
        <div className="pt-4">
          <ConfirmationDialogCrossChain>
            {({ onClick, isWritePending, isLoading, isError, error, isConfirming }) => (
              <div className="space-y-4">
                <Button
                  fullWidth
                  size="xl"
                  loading={isLoading && !isError}
                  onClick={onClick}
                  disabled={isWritePending || Boolean(isLoading && +value > 0) || isError}
                  color={isError ? 'red' : warningSeverity(trade?.priceImpact) >= 3 ? 'red' : 'blue'}
                >
                  {isError ? (
                    'Shoot! Something went wrong :('
                  ) : isConfirming ? (
                    <Dots>Confirming transaction</Dots>
                  ) : isWritePending ? (
                    <Dots>Confirm Swap</Dots>
                  ) : (
                    `Swap ${token0?.symbol} for ${token1?.symbol}`
                  )}
                </Button>
                <Collapsible open={!!error}>
                  <div className="scroll bg-red/20 text-red-700 dark:bg-black/20 p-2 px-3 rounded-lg border border-slate-200/10 text-[10px] break-all max-h-[80px] overflow-y-auto">
                    {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
                    {/* @ts-ignore */}
                    <code>{error ? ('data' in error ? error?.data?.message : error.message) : ''}</code>
                  </div>
                </Collapsible>
              </div>
            )}
          </ConfirmationDialogCrossChain>
        </div>
      </div>
    </Dialog>
  )
}
