import { prisma } from "../src/config/prisma";

async function main() {
  const pro = await prisma.profesional.findFirst({
    include: { servicios_publicados: true, usuario: true },
  });

  const cliente = await prisma.usuario.findFirst({
    where: { rol: "CLIENTE" },
  });

  if (!pro || !cliente || !pro.servicios_publicados.length) {
    console.log("No se encontraron profesional o cliente para vincular.");
    return;
  }

  const servicio = pro.servicios_publicados[0];

  let solicitud = await prisma.solicitudTrabajo.findFirst({
    where: {
      cliente_id: cliente.id,
      servicio_id: servicio.id,
    },
  });

  if (!solicitud) {
    solicitud = await prisma.solicitudTrabajo.create({
      data: {
        cliente_id: cliente.id,
        servicio_id: servicio.id,
        fecha_solicitada: new Date(),
        estado_solicitud_trabajo: "ACEPTADO",
      },
    });
    console.log("✅ Creada SolicitudTrabajo de prueba con ID:", solicitud.id);
  } else {
    console.log("ℹ️ Solicitud existente con ID:", solicitud.id);
  }

  const countMensajes = await prisma.mensajeChat.count({
    where: { solicitud_id: solicitud.id },
  });

  if (countMensajes === 0) {
    await prisma.mensajeChat.create({
      data: {
        solicitud_id: solicitud.id,
        remitente_id: cliente.id,
        contenido: "¡Hola! Quería consultar por la disponibilidad para el servicio.",
        leido: true,
      },
    });
    console.log("✅ Mensaje inicial insertado.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
