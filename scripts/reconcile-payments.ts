import "dotenv/config";
import { EstadoPago } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { paymentService } from "../src/services/payment.service";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMITE = 50;

interface Resultado {
  referencia: string;
  ok: boolean;
  detalle: string;
}

async function reconciliarEventosPendientes(): Promise<Resultado[]> {
  const eventos = await prisma.webhookEvent.findMany({
    where: { procesado: false, tipo: "payment" },
    orderBy: { recibido_en: "asc" },
    take: LIMITE,
  });

  console.log(
    `\n[Eventos] ${eventos.length} evento(s) de webhook sin procesar encontrados.`,
  );

  const resultados: Resultado[] = [];

  for (const evento of eventos) {
    if (DRY_RUN) {
      resultados.push({
        referencia: evento.mp_event_id,
        ok: true,
        detalle: "dry-run: se procesaría",
      });
      continue;
    }

    try {
      await paymentService.processPaymentWebhook(evento.mp_event_id);

      await prisma.webhookEvent.update({
        where: { id: evento.id },
        data: { procesado: true, procesado_en: new Date(), error: null },
      });

      resultados.push({
        referencia: evento.mp_event_id,
        ok: true,
        detalle: "procesado",
      });
    } catch (error: any) {
      const mensaje: string = error?.message ?? String(error);

      await prisma.webhookEvent.update({
        where: { id: evento.id },
        data: { error: mensaje },
      });

      resultados.push({
        referencia: evento.mp_event_id,
        ok: false,
        detalle: mensaje,
      });
    }
  }

  return resultados;
}

async function reconciliarPagosPendientes(): Promise<Resultado[]> {
  const pagos = await prisma.pagoEscrow.findMany({
    where: {
      estado_pago: EstadoPago.PENDIENTE,
      transaccion_mp_id: { not: null },
    },
    orderBy: { creado_en: "asc" },
    take: LIMITE,
    select: { id: true, transaccion_mp_id: true },
  });

  console.log(
    `\n[Pagos] ${pagos.length} pago(s) PENDIENTE con transacción de MP.`,
  );

  const resultados: Resultado[] = [];

  for (const pago of pagos) {
    const mpPaymentId = pago.transaccion_mp_id as string;

    if (DRY_RUN) {
      resultados.push({
        referencia: mpPaymentId,
        ok: true,
        detalle: `dry-run: pago ${pago.id} se reconsultaría`,
      });
      continue;
    }

    try {
      await paymentService.processPaymentWebhook(mpPaymentId);
      resultados.push({
        referencia: mpPaymentId,
        ok: true,
        detalle: `pago ${pago.id} reconsultado`,
      });
    } catch (error: any) {
      resultados.push({
        referencia: mpPaymentId,
        ok: false,
        detalle: error?.message ?? String(error),
      });
    }
  }

  return resultados;
}

function imprimirResumen(titulo: string, resultados: Resultado[]): void {
  if (resultados.length === 0) return;

  console.log(`\n=== ${titulo} ===`);
  for (const r of resultados) {
    const icono = r.ok ? "OK  " : "FAIL";
    console.log(`[${icono}] ${r.referencia} → ${r.detalle}`);
  }
}

async function main(): Promise<void> {
  console.log(
    `\n=== Reconciliación de pagos${DRY_RUN ? " (DRY RUN)" : ""} ===`,
  );

  const eventos = await reconciliarEventosPendientes();
  const pagos = await reconciliarPagosPendientes();

  imprimirResumen("Webhooks", eventos);
  imprimirResumen("Pagos", pagos);

  const fallos = [...eventos, ...pagos].filter((r) => !r.ok).length;

  console.log(
    `\nResumen: ${eventos.length + pagos.length} procesado(s), ${fallos} fallo(s).`,
  );

  if (fallos > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("\n[Reconciliación] Error fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
