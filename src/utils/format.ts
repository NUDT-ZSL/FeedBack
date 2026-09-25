const currencyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  minimumFractionDigits: 2,
});

export const formatCurrency = (amount: number): string =>
  currencyFormatter.format(amount);

export const formatDate = (dateString: string): string =>
  new Date(dateString).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

export const toDateInputValue = (date: Date = new Date()): string =>
  date.toISOString().split('T')[0];

export const parseAmount = (value: string): number => parseFloat(value);
