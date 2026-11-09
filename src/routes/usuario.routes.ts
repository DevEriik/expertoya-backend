import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { actualizarPreferencias } from "../controllers/notification.controller";

const router = Router();

router.use(verifyToken);

router.patch("/me/preferencias", actualizarPreferencias);

export default router;
