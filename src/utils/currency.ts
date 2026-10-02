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
