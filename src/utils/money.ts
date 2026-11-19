import { Prisma } from "@prisma/client";

/**
 * Redondea un valor Decimal a la cantidad de decimales especificada (por defecto 2).
 * @param value El valor Decimal a redondear.
 * @param decimalPlaces La cantidad de decimales.
 * @returns Un nuevo objeto Decimal redondeado.
 */
export const roundDecimal = (
  value: Prisma.Decimal | number,
  decimalPlaces: number = 2,
): Prisma.Decimal => {
  if (typeof value === "number") {
    value = new Prisma.Decimal(value);
  }
  // Prisma.Decimal no tiene un método round con decimalPlaces directamente.
  // Se simula multiplicando, redondeando y dividiendo.
  const factor = new Prisma.Decimal(10).pow(decimalPlaces);
  return value
    .times(factor)
    .toDP(0, Prisma.Decimal.ROUND_HALF_UP)
    .dividedBy(factor);
};

/**
 * Formatea un monto Decimal a string con 2 decimales, usando el formato de moneda ARS.
 * @param amount El monto a formatear.
 * @returns String formateado.
 */
export const formatCurrency = (amount: Prisma.Decimal | number): string => {
  if (typeof amount === "number") {
    amount = new Prisma.Decimal(amount);
  }
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount.toNumber());
};

/**
 * Convierte un número o string a Prisma.Decimal.
 * @param value El valor a convertir.
 * @returns Un objeto Prisma.Decimal.
 */
export const toDecimal = (
  value: string | number | Prisma.Decimal,
): Prisma.Decimal => {
  if (value instanceof Prisma.Decimal) {
    return value;
  }
  return new Prisma.Decimal(value);
};

/**
 * Compara dos Prisma.Decimal.
 * @param a Primer Decimal.
 * @param b Segundo Decimal.
 * @param tolerance Tolerancia para la comparación de igualdad (por defecto 0).
 * @returns -1 si a < b, 0 si a == b, 1 si a > b.
 */
export const compareDecimals = (
  a: Prisma.Decimal,
  b: Prisma.Decimal,
  tolerance: Prisma.Decimal = new Prisma.Decimal(0),
): number => {
  const diff = a.minus(b).abs();
  if (diff.lessThanOrEqualTo(tolerance)) {
    return 0; // Se consideran iguales dentro de la tolerancia
  }
  return a.comparedTo(b);
};
