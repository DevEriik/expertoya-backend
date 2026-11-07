import { TipoMovimientoPago } from "@prisma/client";

/**
 * Genera una referencia única para un movimiento de pago,
 * asegurando idempotencia para cada tipo de transacción.
 * @param tipo El tipo de movimiento de pago.
 * @param id Identificador de la transacción (ej. mp_payment_id, payout_id, mp_refund_id).
 * @param suffix Un sufijo opcional para casos donde un mismo ID puede tener múltiples movimientos (ej. ajustes).
 * @returns Una cadena de referencia única.
 */
export const generateLedgerReference = (
  tipo: TipoMovimientoPago,
  id: string,
  suffix?: string,
): string => {
  return `${tipo.toLowerCase()}:${id}${suffix ? `:${suffix}` : ""}`;
};
