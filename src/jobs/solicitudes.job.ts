import cron from "node-cron";
import { prisma } from "../config/prisma";

export const iniciarCronSolicitudes = () => {
    cron.schedule("*/10 * * * *", async () => {
        try {
        const now = new Date();

        const result = await prisma.solicitudTrabajo.updateMany({
            where: {
            estado_solicitud_trabajo: "PENDIENTE",
            expira_at: {
                lt: now,
            },
            },
            data: {
            estado_solicitud_trabajo: "CANCELADO_AUTO",
            },
        });

        if (result.count > 0) {
            console.log(
            `⏱️ Cron: Se cancelaron automáticamente ${result.count} solicitudes expiradas (> 48h).`,
            );
        }
        } catch (error) {
        console.error("❌ Error al ejecutar el cron de solicitudes:", error);
        }
    });

    console.log(
        "⏰ Cron de cancelación de solicitudes (48h) iniciado (*/10 * * * *).",
    );
};
