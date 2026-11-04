import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { paymentService } from "../services/payment.service";

const manejarError = (res: Response, error: any, contexto: string): void => {
  const mensaje: string = error?.message || "Error interno";

  console.error(`[paymentController] ${contexto}:`, mensaje);

  if (typeof error?.statusCode === "number") {
    res.status(error.statusCode).json({ error: mensaje });
    return;
  }

  const esNoEncontrado = /no encontrad[oa]/i.test(mensaje);
  const esPermiso = /no tienes permiso|no autorizad|acceso denegado/i.test(
    mensaje,
  );
  const esNegocio =
    /debe estar|ya existe|obligatorio|no se puede|no cumple|inv[aá]lid|monto|expirad/i.test(
      mensaje,
    );

  const status = esNoEncontrado ? 404 : esPermiso ? 403 : esNegocio ? 400 : 500;

  res.status(status).json({
    error: status === 500 ? "Error interno al procesar el pago" : mensaje,
  });
};

export const paymentController = {
  createPaymentPreference: async (
    req: AuthRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const clienteId = req.user?.userId;
      if (!clienteId) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }

      const { solicitud_id } = req.body ?? {};
      if (!solicitud_id || typeof solicitud_id !== "string") {
        res.status(400).json({ error: "Se requiere 'solicitud_id'" });
        return;
      }

      const resultado = await paymentService.createPaymentPreference(
        solicitud_id,
        clienteId,
      );

      res.status(201).json({ ok: true, preferencia: resultado });
    } catch (error: any) {
      manejarError(res, error, "createPaymentPreference");
    }
  },

  getPaymentDetails: async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const rol = req.user?.rol;
      const { solicitudId } = req.params;

      if (!userId || !rol) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }

      if (!solicitudId) {
        res.status(400).json({ error: "Se requiere el ID de la solicitud" });
        return;
      }

      const detalles = await paymentService.getPaymentDetails(
        solicitudId,
        userId,
        rol,
      );

      res.json({ ok: true, ...detalles });
    } catch (error: any) {
      manejarError(res, error, "getPaymentDetails");
    }
  },

  confirmCompletion: async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const { solicitudId } = req.params;

      if (!userId) {
        res.status(401).json({ error: "No autenticado" });
        return;
      }

      if (!solicitudId) {
        res.status(400).json({ error: "Se requiere el ID de la solicitud" });
        return;
      }

      const resultado = await paymentService.confirmCompletion(
        solicitudId,
        userId,
      );

      res.json({ ok: true, ...resultado });
    } catch (error: any) {
      manejarError(res, error, "confirmCompletion");
    }
  },
};
