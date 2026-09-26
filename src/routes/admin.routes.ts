import { Router } from "express";
import {
  getPendingProfessionals,
  approveProfessional,
  rejectProfessional,
} from "../controllers/admin.controller";
import { verifyToken, isAdmin } from "../middlewares/auth.middleware";

const router = Router();

// Protegemos todas las rutas de este archivo con verifyToken e isAdmin
router.use(verifyToken, isAdmin);

// Endpoint pedido en Linear: GET /admin/pending-professionals
router.get("/pending-professionals", getPendingProfessionals);

// Endpoints para aprobar o rechazar perfil
router.patch("/professionals/:id/approve", approveProfessional);
router.patch("/professionals/:id/reject", rejectProfessional);

export default router;
