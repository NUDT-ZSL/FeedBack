import type { Currency, ExchangeRate } from '../types';

export const exchangeRate: ExchangeRate = {
  copper: 1,
  silver: 1000,
  silk: 10000
};

export function convertToCopper(amount: number, currency: Currency): number {
  return amount * exchangeRate[currency];
}

export function convertFromCopper(copperAmount: number, targetCurrency: Currency): number {
  return copperAmount / exchangeRate[targetCurrency];
}

export function convertCurrency(
  amount: number,
  fromCurrency: Currency,
  toCurrency: Currency
): number {
  const copperAmount = convertToCopper(amount, fromCurrency);
  return convertFromCopper(copperAmount, toCurrency);
}

export function formatCurrency(amount: number, currency: Currency): string {
  const symbols: Record<Currency, string> = {
    copper: '文',
    silver: '两',
    silk: '匹'
  };
  const names: Record<Currency, string> = {
    copper: '铜钱',
    silver: '白银',
    silk: '丝绸'
  };
  return `${amount}${symbols[currency]} ${names[currency]}`;
}

export function formatCopperValue(copperAmount: number): string {
  if (copperAmount >= exchangeRate.silk) {
    const silk = Math.floor(copperAmount / exchangeRate.silk);
    const remainder = copperAmount % exchangeRate.silk;
    if (remainder === 0) return `${silk}匹丝绸`;
    const silver = Math.floor(remainder / exchangeRate.silver);
    const copper = remainder % exchangeRate.silver;
    return `${silk}匹丝绸 ${silver}两白银 ${copper}文铜钱`;
  }
  if (copperAmount >= exchangeRate.silver) {
    const silver = Math.floor(copperAmount / exchangeRate.silver);
    const copper = copperAmount % exchangeRate.silver;
    if (copper === 0) return `${silver}两白银`;
    return `${silver}两白银 ${copper}文铜钱`;
  }
  return `${copperAmount}文铜钱`;
}

export function getCurrencyName(currency: Currency): string {
  const names: Record<Currency, string> = {
    copper: '铜钱',
    silver: '白银',
    silk: '丝绸'
  };
  return names[currency];
}

/**
 * 按货币口径取整：铜钱取整到文，白银/丝绸保留两位小数。
 * 展示与入账共用此函数，避免多次换算产生金额漂移。
 */
export function roundToCurrency(amount: number, currency: Currency): number {
  if (currency === 'copper') return Math.round(amount);
  return Math.round(amount * 10000) / 10000;
}

/** 将铜钱金额一次性换算为目标结算货币（含取整） */
export function convertCopperToCurrency(copperAmount: number, currency: Currency): number {
  return roundToCurrency(convertFromCopper(copperAmount, currency), currency);
}

/** 将铜钱金额格式化为指定结算货币口径的字符串（展示与入账同源） */
export function formatAmountInCurrency(copperAmount: number, currency: Currency): string {
  return formatCurrency(convertCopperToCurrency(copperAmount, currency), currency);
}
