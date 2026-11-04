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

export default paymentRouter;
