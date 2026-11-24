export const formatCurrency = (amount: number, currency = 'TZS') => {
  return new Intl.NumberFormat('sw-TZ', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
};
