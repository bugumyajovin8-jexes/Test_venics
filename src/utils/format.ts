export const formatCurrency = (amount: number, currency = 'TZS') => {
  return new Intl.NumberFormat('sw-TZ', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
  }).format(amount);
};

export const formatInputNumber = (val: string) => {
  // Allow digits and one decimal point
  let num = val.replace(/[^0-9.]/g, '');
  
  // Ensure only one decimal point
  const parts = num.split('.');
  if (parts.length > 2) {
    num = parts[0] + '.' + parts.slice(1).join('');
  }
  
  if (!num) return '';
  
  // If ends with decimal, keep it so user can type ".5" etc
  if (num.endsWith('.')) {
    const wholeStr = Number(num.slice(0, -1)).toLocaleString('en-US');
    return wholeStr === '0' && num.startsWith('.') ? '0.' : wholeStr + '.';
  }
  
  // Handle decimal places properly
  if (num.includes('.')) {
    const [whole, decimal] = num.split('.');
    return Number(whole).toLocaleString('en-US') + '.' + decimal;
  }
  
  return Number(num).toLocaleString('en-US');
};

export const parseInputNumber = (val: string | number) => {
  if (typeof val === 'number') return val;
  return Number(val.replace(/,/g, '')) || 0;
};
