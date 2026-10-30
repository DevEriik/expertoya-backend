import cron from "node-cron";
import { reenviarNotificacionesCriticas } from "../services/notification.service";

let ejecutando = false;

export function iniciarCronNotificaciones(): void {
  const schedule = process.env.NOTIFICACIONES_CRON_SCHEDULE || "*/5 * * * *";

  cron.schedule(schedule, async () => {
    if (ejecutando) {
      console.log(
        "[Notificaciones] La tanda anterior sigue en curso; se omite esta ejecución",
      );
      return;
    }

    ejecutando = true;
    try {
      await reenviarNotificacionesCriticas();
    } catch (error: any) {
      console.error(
        "[Notificaciones] Error en el cron de críticas:",
        error?.message || error,
      );
    } finally {
      ejecutando = false;
    }
  });

  console.log(`⏰ Cron de notificaciones críticas iniciado (${schedule})`);
}
