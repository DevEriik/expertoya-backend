import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import {
  registrarToken,
  listarNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
} from "../controllers/notification.controller";

const router = Router();

router.use(verifyToken);

router.post("/token", registrarToken);
router.get("/", listarNotificaciones);
router.patch("/leer-todas", marcarTodasLeidas);
router.patch("/:id/leer", marcarLeida);

export default router;
