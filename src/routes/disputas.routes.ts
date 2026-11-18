import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { disputasController } from "../controllers/disputas.controller";

const disputasRouter = Router();

// Rutas de cliente y participantes
disputasRouter.post(
    "/",
    authMiddleware(["CLIENTE"]),
    disputasController.abrirDisputa,
);

disputasRouter.get(
    "/solicitud/:solicitudId",
    authMiddleware(),
    disputasController.obtenerDisputaPorSolicitud,
);

// Rutas exclusivas de administración / moderación
disputasRouter.get(
    "/admin/todas",
    authMiddleware(["ADMIN"]),
    disputasController.listarDisputasAdmin,
);

disputasRouter.get(
    "/admin/:disputaId/chat",
    authMiddleware(["ADMIN"]),
    disputasController.obtenerHistorialChatDisputa,
);

disputasRouter.post(
    "/admin/:disputaId/resolver",
    authMiddleware(["ADMIN"]),
    disputasController.resolverDisputaAdmin,
);

export default disputasRouter;
