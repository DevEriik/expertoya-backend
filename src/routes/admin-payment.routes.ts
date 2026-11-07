import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminPaymentController } from "../controllers/admin-payment.controller";

const adminPaymentRouter = Router();

adminPaymentRouter.use(authMiddleware(["ADMIN"]));

adminPaymentRouter.post(
  "/pagos/:pagoId/liberar",
  adminPaymentController.liberarPago,
);

adminPaymentRouter.post(
  "/pagos/:pagoId/reembolsar",
  adminPaymentController.reembolsarPago,
);

adminPaymentRouter.get("/payouts", adminPaymentController.listarPayouts);

adminPaymentRouter.post(
  "/payouts/:payoutId/confirmar",
  adminPaymentController.confirmarPayout,
);

adminPaymentRouter.post(
  "/payouts/:payoutId/reintentar",
  adminPaymentController.reintentarPayout,
);

export default adminPaymentRouter;
