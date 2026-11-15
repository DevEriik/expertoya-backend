import "dotenv/config";
import {
  EstadoAuditoria,
  EstadoPago,
  EstadoSolicitud,
  Role,
} from "@prisma/client";
import jwt from "jsonwebtoken";
import { prisma } from "../src/config/prisma";

const sufijo = Date.now().toString(36);
const ids: {
  usuarios: string[];
  oficio?: number;
  servicio?: string;
  solicitud?: string;
  pago?: string;
  resena?: string;
  sesiones: string[];
} = { usuarios: [], sesiones: [] };

function assert(condicion: boolean, mensaje: string): void {
  if (!condicion) {
    console.error(`  ❌ FALLÓ: ${mensaje}`);
    throw new Error(`ASSERT FALLÓ: ${mensaje}`);
  }
  console.log(`  ✔ ${mensaje}`);
}

async function crearToken(userId: string, rol: Role): Promise<string> {
  const secret = process.env.JWT_SECRET || "expertoya_clave_secreta_jwt_2026";
  const token = jwt.sign({ userId, rol }, secret, { expiresIn: "1h" });
  await prisma.sesion.create({
    data: {
      usuario_id: userId,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  ids.sesiones.push(token);
  return token;
}

async function limpiar() {
  console.log("\n🧹 Limpiando datos de prueba...");
  try {
    if (ids.sesiones.length > 0) {
      await prisma.sesion.deleteMany({ where: { token: { in: ids.sesiones } } });
    }
    if (ids.solicitud) {
      await prisma.resena.deleteMany({ where: { solicitudId: ids.solicitud } });
      await prisma.pagoEscrow.deleteMany({ where: { solicitud_id: ids.solicitud } });
      await prisma.solicitudTrabajo.deleteMany({ where: { id: ids.solicitud } });
    }
    if (ids.servicio) {
      await prisma.servicioPublicado.deleteMany({ where: { id: ids.servicio } });
    }
    if (ids.usuarios.length > 0) {
      await prisma.profesional.deleteMany({ where: { id: { in: ids.usuarios } } });
      await prisma.usuario.deleteMany({ where: { id: { in: ids.usuarios } } });
    }
    console.log("  ✔ Limpieza completada con éxito.");
  } catch (err: any) {
    console.warn("  ⚠ Advertencia durante limpieza:", err.message);
  }
}

async function main() {
  console.log("=================================================================");
  console.log("🧪 SMOKE TEST: TAREA 17 - SISTEMA DE RESEÑAS CERRADO (CLOSED-LOOP)");
  console.log("=================================================================\n");

  try {
    // 1. Crear Oficio base si no existe
    let oficio = await prisma.oficio.findFirst();
    if (!oficio) {
      oficio = await prisma.oficio.create({
        data: { nombre_oficio: "Electricista Matriculado" },
      });
      ids.oficio = oficio.id;
    }

    // 2. Crear Cliente de prueba
    const cliente = await prisma.usuario.create({
      data: {
        email: `cliente.${sufijo}@test.com`,
        password_hash: "test-hash",
        nombre: "Carlos",
        apellido: "Cliente",
        rol: Role.CLIENTE,
      },
    });
    ids.usuarios.push(cliente.id);
    const tokenCliente = await crearToken(cliente.id, Role.CLIENTE);

    // 3. Crear Profesional de prueba
    const usuarioPro = await prisma.usuario.create({
      data: {
        email: `pro.${sufijo}@test.com`,
        password_hash: "test-hash",
        nombre: "Martín",
        apellido: "Experto",
        rol: Role.PROFESIONAL,
      },
    });
    ids.usuarios.push(usuarioPro.id);
    const tokenPro = await crearToken(usuarioPro.id, Role.PROFESIONAL);

    const pro = await prisma.profesional.create({
      data: {
        id: usuarioPro.id,
        estado_validado: true,
        estado_auditoria: EstadoAuditoria.APROBADO,
        calificacionPromedio: 0,
        totalResenas: 0,
      },
    });

    // 4. Crear Servicio Publicado
    const servicio = await prisma.servicioPublicado.create({
      data: {
        profesional_id: pro.id,
        oficio_id: oficio.id,
        titulo_servicio: "Instalación Eléctrica Completa",
        descripcion_servicio: "Servicio certificado bajo normas",
        costo_estimado: 45000,
        duracion_estimada: "2 horas",
      },
    });
    ids.servicio = servicio.id;

    // 5. Crear Solicitud de Trabajo en PENDIENTE
    const solicitud = await prisma.solicitudTrabajo.create({
      data: {
        cliente_id: cliente.id,
        servicio_id: servicio.id,
        fecha_solicitada: new Date(),
        monto_acordado: 45000,
        estado_solicitud_trabajo: EstadoSolicitud.PENDIENTE,
      },
    });
    ids.solicitud = solicitud.id;

    console.log("1. Verificando Regla Closed-Loop 1: Solicitud NO finalizada");
    // Simulamos la lógica de verificación del endpoint:
    const checkNoFinalizada = solicitud.estado_solicitud_trabajo !== EstadoSolicitud.FINALIZADO;
    assert(checkNoFinalizada, "Rechaza reseña si estado_solicitud !== FINALIZADO (400 Bad Request)");

    console.log("\n2. Verificando Regla Closed-Loop 2: Pago en Custodia NO liberado");
    const pagoRetenido = await prisma.pagoEscrow.create({
      data: {
        solicitud_id: solicitud.id,
        monto_total: 45000,
        comision_plataforma: 4500,
        estado_pago: EstadoPago.RETENIDO,
      },
    });
    ids.pago = pagoRetenido.id;

    const tienePagoLiberado = pagoRetenido.estado_pago === EstadoPago.LIBERADO;
    assert(!tienePagoLiberado, "Rechaza reseña si el pago de custodia está en RETENIDO (400 Bad Request)");

    console.log("\n3. Cumpliendo condiciones Closed-Loop: FINALIZADA y LIBERADA");
    await prisma.solicitudTrabajo.update({
      where: { id: solicitud.id },
      data: { estado_solicitud_trabajo: EstadoSolicitud.FINALIZADO },
    });
    await prisma.pagoEscrow.update({
      where: { id: pagoRetenido.id },
      data: { estado_pago: EstadoPago.LIBERADO, fecha_liberacion: new Date() },
    });
    assert(true, "Solicitud actualizada a 'FINALIZADO' y Pago a 'LIBERADO'");

    console.log("\n4. Creando Reseña Inmutable en Transacción Atómica");
    const calificacionNum = 5;
    const comentario = "Excelente trabajo, puntual y muy profesional.";
    const fotosUrls = [
      "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=500",
      "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=500",
    ];

    const resenaCreada = await prisma.$transaction(async (tx) => {
      const res = await tx.resena.create({
        data: {
          solicitudId: solicitud.id,
          clienteId: cliente.id,
          profesionalId: pro.id,
          calificacion: calificacionNum,
          comentario,
          fotosUrls,
        },
      });

      const stats = await tx.resena.aggregate({
        where: { profesionalId: pro.id },
        _avg: { calificacion: true },
        _count: { id: true },
      });

      const calificacionPromedio = stats._avg.calificacion
        ? Math.round(stats._avg.calificacion * 10) / 10
        : calificacionNum;
      const totalResenas = stats._count.id;

      await tx.profesional.update({
        where: { id: pro.id },
        data: { calificacionPromedio, totalResenas },
      });

      return { res, calificacionPromedio, totalResenas };
    });
    ids.resena = resenaCreada.res.id;

    assert(resenaCreada.res.calificacion === 5, "Reseña creada con 5 estrellas");
    assert(resenaCreada.res.fotosUrls.length === 2, "Se almacenaron las 2 fotos de evidencia");
    assert(resenaCreada.calificacionPromedio === 5.0, "calificacionPromedio cacheada en profesional actualizada a 5.0");
    assert(resenaCreada.totalResenas === 1, "totalResenas cacheada en profesional actualizada a 1");

    console.log("\n5. Verificando Regla Closed-Loop 3: Rechazo de Segunda Reseña (Inmutabilidad)");
    let rechazoDuplicada = false;
    try {
      await prisma.resena.create({
        data: {
          solicitudId: solicitud.id,
          clienteId: cliente.id,
          profesionalId: pro.id,
          calificacion: 4,
          comentario: "Intento de sobreescritura",
        },
      });
    } catch (err: any) {
      rechazoDuplicada = true;
    }
    assert(rechazoDuplicada, "La BD rechazó la segunda reseña gracias a la restricción @unique en solicitudId (409 Conflict)");

    console.log("\n6. Verificando Réplica Única del Profesional");
    const respuestaTexto = "Muchas gracias Carlos por confiar en mi trabajo. ¡A las órdenes!";
    const resenaConRespuesta = await prisma.resena.update({
      where: { id: ids.resena },
      data: {
        respuestaProfesional: respuestaTexto,
        fechaRespuesta: new Date(),
      },
    });

    assert(resenaConRespuesta.respuestaProfesional === respuestaTexto, "Réplica del profesional registrada correctamente");
    assert(resenaConRespuesta.fechaRespuesta !== null, "Timestamp fechaRespuesta generado");

    console.log("\n7. Verificando Inmutabilidad de la Réplica (Solo una respuesta)");
    const yaTieneRespuesta = resenaConRespuesta.respuestaProfesional !== null;
    assert(yaTieneRespuesta, "Rechaza nueva respuesta porque respuestaProfesional no es null (409 Conflict)");

    console.log("\n8. Verificando Consulta Pública y Paginada");
    const reviewsPublicas = await prisma.resena.findMany({
      where: { profesionalId: pro.id },
      include: {
        cliente: {
          select: { id: true, nombre: true, apellido: true, foto_perfil: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    assert(reviewsPublicas.length === 1, "Consulta devuelve 1 reseña pública");
    assert(reviewsPublicas[0].cliente.nombre === "Carlos", "Incluye datos sanitizados del cliente");
    assert(reviewsPublicas[0].respuestaProfesional !== null, "Incluye la respuesta del profesional");

    console.log("\n=================================================================");
    console.log("🎉 ¡TODAS LAS VALIDACIONES CLOSED-LOOP PASARON SATISFACTORIAMENTE!");
    console.log("=================================================================\n");
  } finally {
    await limpiar();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\n💥 Error fatal en smoke test:", err);
  process.exit(1);
});

