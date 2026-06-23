export function cleanName(name) {
  return (name || '')
    .replace(/&#?\w+;/g, '')
    .replace(/[^\w\s./#,()&-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatPrice(amount) {
  return `Rs ${amount.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`;
}
