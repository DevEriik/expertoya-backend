import { Router } from "express";
import { webhookController } from "../controllers/webhook.controller";

const webhookRouter = Router();

webhookRouter.post("/", webhookController.handleMercadoPagoWebhook);

export default webhookRouter;
