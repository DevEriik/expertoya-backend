import { Router } from "express";
import {
  getPendingProfessionals,
  approveProfessional,
  rejectProfessional,
} from "../controllers/admin.controller";
import { verifyToken, isAdmin } from "../middlewares/auth.middleware";

const router = Router();

// Endpoints protegidos para administradores
router.get("/pending-professionals", verifyToken, isAdmin, getPendingProfessionals);
router.patch("/professionals/:id/approve", verifyToken, isAdmin, approveProfessional);
router.patch("/professionals/:id/reject", verifyToken, isAdmin, rejectProfessional);

export default router;