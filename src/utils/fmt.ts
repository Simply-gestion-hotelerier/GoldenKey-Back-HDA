export const fmt = (amount: number): string => {
  return new Intl.NumberFormat('fr-MG').format(amount);
};