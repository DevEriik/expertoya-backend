import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { mercadoPagoService } from "../services/mercadopago.service";
import { paymentService } from "../services/payment.service";

interface WebhookPayload {
  id?: string | number;
  type?: string;
  topic?: string;
  action?: string;
  data?: { id?: string | number };
  live_mode?: boolean;
}

const extraerEvento = (req: Request) => {
  const payload = (req.body ?? {}) as WebhookPayload;

  const dataIdRaw =
    req.query["data.id"] ?? payload.data?.id ?? req.query.id ?? payload.id;
  const tipoRaw =
    req.query.type ?? payload.type ?? payload.topic ?? req.query.topic;

  const dataId = dataIdRaw != null ? String(dataIdRaw) : "";
  const tipo = tipoRaw ? String(tipoRaw) : "desconocido";
  const accion = payload.action ?? null;

  return { dataId, tipo, accion, payload };
};

export const webhookController = {
  handleMercadoPagoWebhook: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const { dataId, tipo, accion, payload } = extraerEvento(req);

    const signature = req.headers["x-signature"];
    const requestId = req.headers["x-request-id"];

    if (env.MP_WEBHOOK_SECRET) {
      const firmaValida = mercadoPagoService.validateWebhookSignature(
        typeof signature === "string" ? signature : "",
        typeof requestId === "string" ? requestId : "",
        dataId,
      );

      if (!firmaValida) {
        console.warn(
          `[Webhook] Firma inválida. tipo=${tipo} dataId=${dataId || "sin-id"}`,
        );
        res.status(401).json({ error: "Firma de webhook inválida" });
        return;
      }
    } else {
      console.warn(
        "[Webhook] MP_WEBHOOK_SECRET no configurado: se omite la validación de firma (solo desarrollo).",
      );
    }

    const mpEventId =
      dataId ||
      (typeof requestId === "string" && requestId) ||
      `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    let evento = await prisma.webhookEvent.findUnique({
      where: { mp_event_id: mpEventId },
    });

    if (evento?.procesado) {
      console.log(`[Webhook] Evento ${mpEventId} ya procesado. Ignorando.`);
      res.status(200).json({ ok: true, duplicado: true });
      return;
    }

    if (!evento) {
      evento = await prisma.webhookEvent.create({
        data: {
          mp_event_id: mpEventId,
          tipo,
          accion,
          payload: payload as object,
        },
      });
    }

    try {
      if (tipo === "payment" && dataId) {
        await paymentService.processPaymentWebhook(dataId);
      } else {
        console.log(
          `[Webhook] Evento tipo "${tipo}" sin acción de pago. Registrado como procesado.`,
        );
      }

      await prisma.webhookEvent.update({
        where: { id: evento.id },
        data: { procesado: true, procesado_en: new Date(), error: null },
      });

      res.status(200).json({ ok: true });
    } catch (error: any) {
      const mensaje: string = error?.message || "Error desconocido";

      console.error(
        `[Webhook] Error procesando evento ${mpEventId} (tipo=${tipo}):`,
        mensaje,
      );

      await prisma.webhookEvent.update({
        where: { id: evento.id },
        data: { error: mensaje },
      });

      res.status(200).json({ ok: false, registrado: true });
    }
  },
};
