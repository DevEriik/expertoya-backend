import cron from "node-cron";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const iniciarCronSolicitudes = () => {
  cron.schedule("*/10 * * * *", async () => {
    try {
      const now = new Date();

      const resultado = await prisma.solicitud.updateMany({
        where: {
          estado: "PENDIENTE",
          expira_at: {
            lt: now,
          },
        },
        data: {
          estado: "CANCELADO_AUTO",
        },
      });

      if (resultado.count > 0) {
        console.log(
          `[Cron] Se cancelaron automáticamente ${resultado.count} solicitudes expiradas.`,
        );
      }
    } catch (error) {
      console.error("[Cron] Error al cancelar solicitudes expiradas:", error);
    }
  });
};
