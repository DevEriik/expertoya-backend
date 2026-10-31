import { Expo } from "expo-server-sdk";
import type { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import type { Notificacion, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
});

export const MAX_REINTENTOS_CRITICA = 3;
export const MINUTOS_ESPERA_REENVIO = 10;
const LIMITE_REENVIO_POR_TANDA = 50;

const CANAL_POR_DEFECTO = "default";
const CANAL_CRITICO = "critical";

export interface NotificarPayload {
  tipo: string;
  titulo: string;
  cuerpo: string;
  data?: Prisma.InputJsonValue;
  critica?: boolean;
}

export async function notificar(
  userId: string,
  payload: NotificarPayload,
): Promise<Notificacion> {
  const notificacion = await prisma.notificacion.create({
    data: {
      userId,
      tipo: payload.tipo,
      titulo: payload.titulo,
      cuerpo: payload.cuerpo,
      data: payload.data ?? {},
      critica: payload.critica ?? false,
    },
  });

  try {
    await enviarPush(notificacion);
  } catch (error: any) {
    console.error(
      `[Notificaciones] Error enviando push ${notificacion.id}:`,
      error?.message || error,
    );
  }

  return notificacion;
}

export async function enviarPush(
  notificacion: Notificacion,
  opciones: { esReenvio?: boolean } = {},
): Promise<boolean> {
  let enviado = false;

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: notificacion.userId },
      select: {
        sonidoActivo: true,
        dispositivos_push: { select: { token: true } },
      },
    });

    if (!usuario) {
      console.warn(
        `[Notificaciones] Usuario ${notificacion.userId} no existe; se omite push`,
      );
      return false;
    }

    const tokens = usuario.dispositivos_push
      .map((d) => d.token)
      .filter((token) => Expo.isExpoPushToken(token));

    if (tokens.length === 0) {
      console.log(
        `[Notificaciones] Sin tokens válidos para ${notificacion.userId}; queda solo en DB`,
      );
      return false;
    }

    const noLeidas = await prisma.notificacion.count({
      where: { userId: notificacion.userId, leida: false },
    });

    const dataBase =
      notificacion.data &&
      typeof notificacion.data === "object" &&
      !Array.isArray(notificacion.data)
        ? (notificacion.data as Record<string, unknown>)
        : {};

    const mensajes: ExpoPushMessage[] = tokens.map((token) => ({
      to: token,
      sound: usuario.sonidoActivo ? "default" : null,
      title: notificacion.titulo,
      body: notificacion.cuerpo,
      data: {
        ...dataBase,
        notificacionId: notificacion.id,
        tipo: notificacion.tipo,
      },
      priority: notificacion.critica ? "high" : "default",
      channelId: notificacion.critica ? CANAL_CRITICO : CANAL_POR_DEFECTO,
      badge: noLeidas,
    }));

    const chunks = expo.chunkPushNotifications(mensajes);
    const tokensInvalidos: string[] = [];

    for (const chunk of chunks) {
      let tickets: ExpoPushTicket[] = [];

      try {
        tickets = await expo.sendPushNotificationsAsync(chunk);
        enviado = true;
      } catch (error: any) {
        console.error(
          "[Notificaciones] Error de red con Expo:",
          error?.message || error,
        );
        continue;
      }

      tickets.forEach((ticket, index) => {
        if (ticket.status === "error") {
          const destinatario = chunk[index];
          console.error(
            `[Notificaciones] Ticket con error (${destinatario?.to}):`,
            ticket.message,
            ticket.details?.error,
          );

          if (
            ticket.details?.error === "DeviceNotRegistered" &&
            destinatario?.to
          ) {
            tokensInvalidos.push(String(destinatario.to));
          }
        }
      });
    }

    if (tokensInvalidos.length > 0) {
      await prisma.dispositivoPush.deleteMany({
        where: { token: { in: tokensInvalidos } },
      });
      console.log(
        `[Notificaciones] Tokens inválidos eliminados: ${tokensInvalidos.length}`,
      );
    }

    return enviado;
  } finally {
    try {
      await prisma.notificacion.update({
        where: { id: notificacion.id },
        data: {
          ultimoEnvioAt: new Date(),
          ...(opciones.esReenvio ? { intentosReenvio: { increment: 1 } } : {}),
        },
      });
    } catch (error: any) {
      console.error(
        `[Notificaciones] No se pudo actualizar el intento de ${notificacion.id}:`,
        error?.message || error,
      );
    }
  }
}

export async function reenviarNotificacionesCriticas(): Promise<void> {
  const limite = new Date(Date.now() - MINUTOS_ESPERA_REENVIO * 60 * 1000);

  const pendientes = await prisma.notificacion.findMany({
    where: {
      critica: true,
      leida: false,
      intentosReenvio: { lt: MAX_REINTENTOS_CRITICA },
      OR: [{ ultimoEnvioAt: null }, { ultimoEnvioAt: { lt: limite } }],
    },
    orderBy: { ultimoEnvioAt: "asc" },
    take: LIMITE_REENVIO_POR_TANDA,
  });

  if (pendientes.length === 0) return;

  console.log(
    `[Notificaciones] Reenviando ${pendientes.length} notificación(es) crítica(s)`,
  );

  for (const notificacion of pendientes) {
    try {
      await enviarPush(notificacion, { esReenvio: true });
    } catch (error: any) {
      console.error(
        `[Notificaciones] Error reenviando ${notificacion.id}:`,
        error?.message || error,
      );
    }
  }
}

export async function notificarLlamadaEntrante(
  userId: string,
  solicitudId: string,
  nombreLlamante: string,
): Promise<Notificacion> {
  return notificar(userId, {
    tipo: "LLAMADA_ENTRANTE",
    titulo: "Llamada entrante",
    cuerpo: `${nombreLlamante} te está llamando`,
    data: {
      ruta: `/llamada/${solicitudId}`,
      solicitudId,
    },
    critica: true,
  });
}

export async function notificarCambioPago(
  userId: string,
  solicitudId: string,
  estado: "RETENIDO" | "LIBERADO" | "REEMBOLSADO",
): Promise<Notificacion> {
  const mensajes: Record<typeof estado, string> = {
    RETENIDO: "El pago quedó retenido en garantía",
    LIBERADO: "El pago fue liberado al profesional",
    REEMBOLSADO: "El pago fue reembolsado",
  };

  return notificar(userId, {
    tipo: "ESTADO_PAGO",
    titulo: "Actualización del pago",
    cuerpo: mensajes[estado],
    data: {
      ruta: `/pagos/${solicitudId}`,
      solicitudId,
      estadoPago: estado,
    },
    critica: estado !== "RETENIDO",
  });
}
