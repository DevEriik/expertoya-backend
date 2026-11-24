import fs from "fs";
import path from "path";
import { initializeApp, getApps, cert, type ServiceAccount } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { Expo } from "expo-server-sdk";
import type { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import type { Notificacion, Prisma, PrismaClient } from "@prisma/client"; // Importar PrismaClient
import { prisma } from "../config/prisma";

const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
});

let firebaseInicializado = false;
function getFirebaseMessaging(): Messaging | null {
  if (firebaseInicializado) {
    return getApps().length > 0 ? getMessaging() : null;
  }
  firebaseInicializado = true;

  try {
    let serviceAccount: ServiceAccount | null = null;
    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (rawJson) {
      serviceAccount = JSON.parse(rawJson);
    } else {
      const candidatePath =
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() ||
        path.resolve(process.cwd(), "firebase-service-account.json");
      if (fs.existsSync(candidatePath)) {
        serviceAccount = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
      }
    }

    if (!serviceAccount) {
      console.warn(
        "[Notificaciones] Firebase Admin no configurado (falta FIREBASE_SERVICE_ACCOUNT_JSON o firebase-service-account.json).",
      );
      return null;
    }

    if (getApps().length === 0) {
      initializeApp({
        credential: cert(serviceAccount),
      });
    }
    return getMessaging();
  } catch (error: any) {
    console.error(
      "[Notificaciones] Error inicializando Firebase Admin:",
      error?.message || error,
    );
    return null;
  }
}

export const MAX_REINTENTOS_CRITICA = 3;
export const MINUTOS_ESPERA_REENVIO = 10;
const LIMITE_REENVIO_POR_TANDA = 50;

const CANAL_POR_DEFECTO = "default";
const CANAL_CRITICO = "critical";

export interface NotificationData {
  type: string;
  solicitudId?: string;
  pagoId?: string;
  role?: string;
  payoutId?: string;
  ruta?: string;
  critica?: boolean; // Añadir esta propiedad
}

export class NotificacionService {
  constructor(private readonly prismaClient: PrismaClient) {}

  async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: NotificationData,
  ): Promise<void> {
    const payload = {
      tipo: data?.type || "GENERIC",
      titulo: title,
      cuerpo: body,
      data: (data as unknown as Prisma.InputJsonValue) ?? {},
      critica: data?.critica ?? false, // Usar la propiedad critica del data
    };
    const notificacion = await this.prismaClient.notificacion.create({
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
      await this.enviarPush(notificacion);
    } catch (error: any) {
      console.error(
        `[Notificaciones] Error enviando push ${notificacion.id}:`,
        error?.message || error,
      );
    }
  }

  private async enviarPush(
    notificacion: Notificacion,
    opciones: { esReenvio?: boolean } = {},
  ): Promise<boolean> {
    let enviado = false;

    try {
      const usuario = await this.prismaClient.usuario.findUnique({
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

      const todosTokens = usuario.dispositivos_push
        .map((d: { token: string }) => d.token)
        .filter((t: string) => typeof t === "string" && t.trim().length >= 20);

      const expoTokens = todosTokens.filter((t: string) =>
        Expo.isExpoPushToken(t),
      );
      const fcmTokens = todosTokens.filter(
        (t: string) => !Expo.isExpoPushToken(t),
      );

      if (expoTokens.length === 0 && fcmTokens.length === 0) {
        console.log(
          `[Notificaciones] Sin tokens válidos para ${notificacion.userId}; queda solo en DB`,
        );
        return false;
      }

      const noLeidas = await this.prismaClient.notificacion.count({
        where: { userId: notificacion.userId, leida: false },
      });

      const dataBase =
        notificacion.data &&
        typeof notificacion.data === "object" &&
        !Array.isArray(notificacion.data)
          ? (notificacion.data as Record<string, unknown>)
          : {};

      const tokensInvalidos: string[] = [];

      // 1. Envío vía Firebase Cloud Messaging (tokens nativos de React Native)
      if (fcmTokens.length > 0) {
        const messaging = getFirebaseMessaging();
        if (messaging) {
          const dataStrings: Record<string, string> = {};
          for (const [k, v] of Object.entries({
            ...dataBase,
            notificacionId: notificacion.id,
            tipo: notificacion.tipo,
          })) {
            if (v !== undefined && v !== null) {
              dataStrings[k] = String(v);
            }
          }

          const canalId = notificacion.critica
            ? CANAL_CRITICO
            : CANAL_POR_DEFECTO;

          try {
            const batchResponse = await messaging.sendEachForMulticast({
              tokens: fcmTokens,
              notification: {
                title: notificacion.titulo,
                body: notificacion.cuerpo,
              },
              data: dataStrings,
              android: {
                priority: "high",
                notification: {
                  channelId: canalId,
                  ...(usuario.sonidoActivo ? { sound: "default" } : {}),
                },
              },
              apns: {
                payload: {
                  aps: {
                    badge: noLeidas,
                    ...(usuario.sonidoActivo ? { sound: "default" } : {}),
                  },
                },
              },
            });

            if (batchResponse.successCount > 0) {
              enviado = true;
            }

            batchResponse.responses.forEach((resp, idx) => {
              if (!resp.success) {
                const code = resp.error?.code;
                console.error(
                  `[Notificaciones FCM] Error (${fcmTokens[idx]}):`,
                  code,
                  resp.error?.message,
                );
                if (
                  code === "messaging/registration-token-not-registered" ||
                  code === "messaging/invalid-registration-token"
                ) {
                  tokensInvalidos.push(fcmTokens[idx]);
                }
              }
            });
          } catch (error: any) {
            console.error(
              "[Notificaciones FCM] Error enviando multicast:",
              error?.message || error,
            );
          }
        }
      }

      // 2. Envío vía Expo (retrocompatibilidad si quedara algún ExponentPushToken)
      if (expoTokens.length > 0) {
        const mensajes: ExpoPushMessage[] = expoTokens.map((token: string) => ({
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
      }

      if (tokensInvalidos.length > 0) {
        await this.prismaClient.dispositivoPush.deleteMany({
          where: { token: { in: tokensInvalidos } },
        });
        console.log(
          `[Notificaciones] Tokens inválidos eliminados: ${tokensInvalidos.length}`,
        );
      }

      return enviado;
    } finally {
      try {
        await this.prismaClient.notificacion.update({
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

  async reenviarNotificacionesCriticas(): Promise<void> {
    const limite = new Date(Date.now() - MINUTOS_ESPERA_REENVIO * 60 * 1000);

    const pendientes = await this.prismaClient.notificacion.findMany({
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
      `[Notificaciones] Reenviando ${pendientes.length} notificación(es) crítica(s)`
    );

    for (const notificacion of pendientes) {
      try {
        await this.enviarPush(notificacion, { esReenvio: true });
      } catch (error: any) {
        console.error(
          `[Notificaciones] Error reenviando ${notificacion.id}:`,
          error?.message || error
        );
      }
    }
  }

  async notificarLlamadaEntrante(
    userId: string,
    solicitudId: string,
    nombreLlamante: string,
  ): Promise<void> {
    await this.sendPushNotification(
      userId,
      "Llamada entrante",
      `${nombreLlamante} te está llamando`,
      {
        type: "LLAMADA_ENTRANTE",
        solicitudId: solicitudId,
        ruta: `/llamada/${solicitudId}`,
        critica: true,
      },
    );
  }

  async notificarCambioPago(
    userId: string,
    solicitudId: string,
    estado: "RETENIDO" | "LIBERADO" | "REEMBOLSADO",
    pagoId?: string,
  ): Promise<void> {
    const mensajes: Record<typeof estado, string> = {
      RETENIDO: "El pago quedó retenido en garantía",
      LIBERADO: "El pago fue liberado al profesional",
      REEMBOLSADO: "El pago fue reembolsado",
    };

    await this.sendPushNotification(
      userId,
      "Actualización del pago",
      mensajes[estado],
      {
        type: "ESTADO_PAGO",
        solicitudId: solicitudId,
        pagoId: pagoId,
        critica: estado !== "RETENIDO",
      },
    );
  }
}

export const notificacionService = new NotificacionService(prisma);

