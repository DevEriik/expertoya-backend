import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { paymentController } from "../controllers/payment.controller";

const paymentRouter = Router();

paymentRouter.post(
  "/preferences",
  authMiddleware(["CLIENTE"]),
  paymentController.createPaymentPreference,
);

paymentRouter.get(
  "/solicitud/:solicitudId",
  authMiddleware(["CLIENTE", "PROFESIONAL", "ADMIN"]),
  paymentController.getPaymentDetails,
);

paymentRouter.post(
  "/solicitud/:solicitudId/confirm",
  authMiddleware(["CLIENTE", "PROFESIONAL"]),
  paymentController.confirmCompletion,
);

// --- Aliases compatibles con el contrato de la issue DAN-22 ---

paymentRouter.post(
  "/create-preference",
  authMiddleware(["CLIENTE"]),
  paymentController.createPaymentPreference,
);

paymentRouter.post(
  "/:solicitudId/confirmar-finalizacion",
  authMiddleware(["CLIENTE", "PROFESIONAL"]),
  paymentController.confirmCompletion,
);

paymentRouter.get(
  "/:solicitudId/comprobante",
  authMiddleware(["CLIENTE", "PROFESIONAL", "ADMIN"]),
  paymentController.getComprobante,
);

export default paymentRouter;
