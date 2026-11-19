import { Response } from "express";
import { EstadoPayout } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";
import { paymentService } from "../services/payment.service";
import { payoutService } from "../services/payout.service";

const manejarError = (res: Response, error: any, contexto: string): void => {
  const mensaje: string = error?.message || "Error interno";

  console.error(`[adminPaymentController] ${contexto}:`, mensaje);

  if (typeof error?.statusCode === "number") {
    res.status(error.statusCode).json({ error: mensaje });
    return;
  }

  const esNoEncontrado = /no encontrad[oa]/i.test(mensaje);
  const esPermiso =
    /no tienes permiso|no autorizad|acceso denegado|solo.*admin/i.test(mensaje);
  const esNegocio =
    /debe estar|ya existe|obligatorio|no se puede|no cumple|inv[aá]lid|monto|expirad|disputa/i.test(
      mensaje,
    );

  const status = esNoEncontrado ? 404 : esPermiso ? 403 : esNegocio ? 400 : 500;

  res.status(status).json({
    error: status === 500 ? "Error interno al procesar la operación" : mensaje,
  });
};

export const adminPaymentController = {
  liberarPago: async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const actorId = req.user?.userId;
      const { pagoId } = req.params;
      const { motivo, override } = req.body ?? {};

      if (!actorId) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }

      const pago = await prisma.pagoEscrow.findUnique({
        where: { id: pagoId },
        select: {
          solicitud_id: true,
          solicitud: {
            select: {
              servicio: {
                select: { profesional: { select: { id: true } } },
              },
            },
          },
        },
      });

      if (!pago) {
        res.status(404).json({ error: "Pago no encontrado" });
        return;
      }

      const profesionalId = pago.solicitud.servicio?.profesional?.id;
      if (!profesionalId) {
        res.status(400).json({
          error:
            "El pago no tiene un profesional asociado: no se puede liberar",
        });
        return;
      }

      const resultado = await paymentService.liberatePayment(
        pago.solicitud_id,
        pagoId,
        profesionalId,
        actorId,
        typeof motivo === "string" ? motivo : undefined,
        Boolean(override),
      );

      res.json({ ok: true, pago: resultado });
    } catch (error: any) {
      manejarError(res, error, "liberarPago");
    }
  },

  reembolsarPago: async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const actorId = req.user?.userId;
      const { pagoId } = req.params;
      const { motivo } = req.body ?? {};

      if (!actorId) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }

      if (!motivo || typeof motivo !== "string") {
        res.status(400).json({ error: "Se requiere 'motivo' del reembolso" });
        return;
      }

      const resultado = await paymentService.refundPayment(
        pagoId,
        actorId,
        motivo,
      );

      res.json({ ok: true, pago: resultado });
    } catch (error: any) {
      manejarError(res, error, "reembolsarPago");
    }
  },

  listarPayouts: async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { estado, profesional_id, solicitud_id, desde, hasta } = req.query;

      let estadoFiltro: EstadoPayout | undefined;
      if (typeof estado === "string" && estado) {
        if (!Object.values(EstadoPayout).includes(estado as EstadoPayout)) {
          res.status(400).json({
            error: `Estado inválido. Valores permitidos: ${Object.values(
              EstadoPayout,
            ).join(", ")}`,
          });
          return;
        }
        estadoFiltro = estado as EstadoPayout;
      }

      const payouts = await payoutService.getPayouts({
        estado: estadoFiltro,
        profesional_id:
          typeof profesional_id === "string" ? profesional_id : undefined,
        solicitud_id:
          typeof solicitud_id === "string" ? solicitud_id : undefined,
        desde: typeof desde === "string" ? new Date(desde) : undefined,
        hasta: typeof hasta === "string" ? new Date(hasta) : undefined,
      });

      res.json({ ok: true, payouts });
    } catch (error: any) {
      manejarError(res, error, "listarPayouts");
    }
  },

  confirmarPayout: async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const actorId = req.user?.userId;
      const { payoutId } = req.params;
      const { referencia } = req.body ?? {};

      if (!actorId) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }

      if (!referencia || typeof referencia !== "string") {
        res.status(400).json({
          error: "Se requiere 'referencia' (ej. ID de transferencia bancaria)",
        });
        return;
      }

      const payout = await payoutService.confirmManualPayout(
        payoutId,
        actorId,
        referencia,
      );

      res.json({ ok: true, payout });
    } catch (error: any) {
      manejarError(res, error, "confirmarPayout");
    }
  },

  reintentarPayout: async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const actorId = req.user?.userId;
      const { payoutId } = req.params;

      if (!actorId) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }

      const payout = await payoutService.retryPayout(payoutId, actorId);

      res.json({ ok: true, payout });
    } catch (error: any) {
      manejarError(res, error, "reintentarPayout");
    }
  },
};
