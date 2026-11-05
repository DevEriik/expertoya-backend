import { prisma } from "../config/prisma";
import { getIO } from "../sockets/io";


export const contarPendientesProfesional = (
  profesional_id: string,
): Promise<number> => {
  return prisma.solicitudTrabajo.count({
    where: {
      servicio: {
        profesional_id: profesional_id, 
      },
      estado_solicitud_trabajo: "PENDIENTE",
      expira_at: { gt: new Date() },
    },
  });
};

export const emitirCambioSolicitudes = async (
  profesional_id: string,
): Promise<void> => {
  try {
    const io = getIO();
    if (!io) return;

    const pendientes = await contarPendientesProfesional(profesional_id);
    const sala = `usuario_${profesional_id}`;

    io.to(sala).emit("solicitudes:contador", { pendientes });
    io.to(sala).emit("solicitudes:cambio", { pendientes });
  } catch (error: any) {
    console.error(
      "Error emitiendo cambio de solicitudes:",
      error?.message || error,
    );
  }
};

export const emitirCambioCliente = (cliente_id: string): void => {
  try {
    getIO()?.to(`usuario_${cliente_id}`).emit("solicitudes:mias-cambio", {});
  } catch (error: any) {
    console.error(
      "Error emitiendo cambio al cliente:",
      error?.message || error,
    );
  }
};
