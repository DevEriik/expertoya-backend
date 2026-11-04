import "dotenv/config";
import {
  EstadoAuditoria,
  EstadoPago,
  EstadoPayout,
  Role,
} from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { paymentService } from "../src/services/payment.service";

/**
 * Smoke test del flujo de pagos SIN Mercado Pago real.
 *
 * Crea un escenario temporal (cliente, profesional, servicio, solicitud y un
 * pago en RETENIDO), ejercita la liberación automática por confirmaciones y
 * verifica el payout y el ledger. Limpia todo al final.
 *
 * Uso: npx tsx scripts/payment-smoke.ts
 */
const sufijo = Date.now().toString(36);
const ids: {
  usuarios: string[];
  servicio?: string;
  solicitud?: string;
  pago?: string;
} = { usuarios: [] };

function assert(condicion: boolean, mensaje: string): void {
  if (!condicion) throw new Error(`ASSERT FALLÓ: ${mensaje}`);
  console.log(`  ✔ ${mensaje}`);
}

async function crearEscenario() {
  const cliente = await prisma.usuario.create({
    data: {
      email: `smoke.${sufijo}.cliente@example.com`,
      password_hash: "smoke-no-login",
      nombre: "Smoke",
      apellido: "Cliente",
      rol: Role.CLIENTE,
    },
  });
  ids.usuarios.push(cliente.id);

  const usuarioPro = await prisma.usuario.create({
    data: {
      email: `smoke.${sufijo}.pro@example.com`,
      password_hash: "smoke-no-login",
      nombre: "Smoke",
      apellido: "Profesional",
      rol: Role.PROFESIONAL,
    },
  });
  ids.usuarios.push(usuarioPro.id);

  await prisma.profesional.create({
    data: {
      id: usuarioPro.id,
      estado_validado: true,
      estado_auditoria: EstadoAuditoria.APROBADO,
      disponible: true,
    },
  });

  const oficio = await prisma.oficio.findFirst({ orderBy: { id: "asc" } });
  if (!oficio) {
    throw new Error("No hay oficios cargados. Ejecutá primero: npm run seed");
  }

  const servicio = await prisma.servicioPublicado.create({
    data: {
      profesional_id: usuarioPro.id,
      oficio_id: oficio.id,
      titulo_servicio: `Servicio smoke ${sufijo}`,
      descripcion_servicio: "Servicio temporal creado por el smoke test",
      costo_estimado: 10000,
      duracion_estimada: "1 hora",
    },
  });
  ids.servicio = servicio.id;

  const solicitud = await prisma.solicitudTrabajo.create({
    data: {
      cliente_id: cliente.id,
      servicio_id: servicio.id,
      fecha_solicitada: new Date(),
      monto_acordado: 10000,
      estado_solicitud_trabajo: "ACEPTADO",
    },
  });
  ids.solicitud = solicitud.id;

  const pago = await prisma.pagoEscrow.create({
    data: {
      solicitud_id: solicitud.id,
      monto_total: 10000,
      comision_porcentaje: 10,
      comision_plataforma: 1000,
      fee_mp: 0,
      monto_neto_profesional: 9000,
      moneda: "ARS",
      estado_pago: EstadoPago.RETENIDO,
      external_reference: `smoke-${sufijo}`,
      fecha_aprobacion: new Date(),
    },
  });
  ids.pago = pago.id;

  return {
    clienteId: cliente.id,
    proId: usuarioPro.id,
    solicitudId: solicitud.id,
    pagoId: pago.id,
    neto: 9000,
  };
}

async function limpiar(): Promise<void> {
  try {
    if (ids.pago) {
      await prisma.movimientoPago.deleteMany({ where: { pago_id: ids.pago } });
      await prisma.payout.deleteMany({ where: { pago_id: ids.pago } });
      await prisma.pagoEscrow.deleteMany({ where: { id: ids.pago } });
    }
    if (ids.solicitud) {
      await prisma.solicitudTrabajo.deleteMany({
        where: { id: ids.solicitud },
      });
    }
    if (ids.servicio) {
      await prisma.servicioPublicado.deleteMany({
        where: { id: ids.servicio },
      });
    }
    for (const usuarioId of ids.usuarios) {
      await prisma.profesional.deleteMany({ where: { id: usuarioId } });
      await prisma.usuario.deleteMany({ where: { id: usuarioId } });
    }
    console.log("\n[Cleanup] Datos de prueba eliminados.");
  } catch (error: any) {
    console.error(
      "[Cleanup] No se pudo limpiar todo:",
      error?.message || error,
    );
  }
}

async function main(): Promise<void> {
  console.log("=== Smoke test de pagos (sin Mercado Pago) ===");
  console.log(`PAYOUT_MODE=${env.PAYOUT_MODE}\n`);

  const escenario = await crearEscenario();
  console.log("Escenario temporal creado.\n");

  console.log("1) Confirmación del cliente");
  const c1 = await paymentService.confirmCompletion(
    escenario.solicitudId,
    escenario.clienteId,
  );
  assert(c1.confirmado_cliente === true, "cliente confirmado");
  assert(c1.liberado === false, "no se libera con una sola confirmación");

  console.log("\n2) Confirmación del profesional (dispara liberación)");
  const c2 = await paymentService.confirmCompletion(
    escenario.solicitudId,
    escenario.proId,
  );
  assert(c2.confirmado_profesional === true, "profesional confirmado");
  assert(c2.liberado === true, "el pago se liberó automáticamente");
  assert(c2.estado_pago === EstadoPago.LIBERADO, "estado del pago = LIBERADO");

  console.log("\n3) Payout generado");
  const payout = await prisma.payout.findUnique({
    where: { pago_id: escenario.pagoId },
  });
  assert(!!payout, "se creó el payout");
  assert(
    Number(payout!.monto) === escenario.neto,
    `monto del payout = ${escenario.neto}`,
  );

  if (env.PAYOUT_MODE === "SIMULADO") {
    assert(
      payout!.estado === EstadoPayout.PAGADO,
      "payout SIMULADO queda PAGADO",
    );
  } else {
    assert(
      payout!.estado === EstadoPayout.PENDIENTE,
      "payout no simulado queda PENDIENTE",
    );
  }

  console.log("\n4) Ledger");
  const movimiento = await prisma.movimientoPago.findFirst({
    where: { pago_id: escenario.pagoId, tipo: "PAYOUT" },
  });
  assert(!!movimiento, "se registró el movimiento PAYOUT");
  assert(
    Number(movimiento!.monto) === -escenario.neto,
    `el PAYOUT es negativo (-${escenario.neto})`,
  );

  console.log("\n5) Idempotencia de la liberación");
  const pagoReliberado = await paymentService.liberatePayment(
    escenario.solicitudId,
    escenario.pagoId,
    escenario.proId,
  );
  assert(
    pagoReliberado.estado_pago === EstadoPago.LIBERADO,
    "liberar de nuevo no cambia el estado",
  );
  const cantidadPayouts = await prisma.payout.count({
    where: { pago_id: escenario.pagoId },
  });
  assert(cantidadPayouts === 1, "no se duplicó el payout");

  console.log("\n✅ Smoke test completado con éxito");
}

main()
  .catch((error: any) => {
    console.error("\n❌ Smoke test falló:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await limpiar();
    await prisma.$disconnect();
  });
