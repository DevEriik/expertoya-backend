import { Router } from "express";
import {
  getProfessionalsByStatus,
  approveProfessional,
  rejectProfessional,
} from "../controllers/admin.controller";
import { verifyToken, isAdmin } from "../middlewares/auth.middleware";

const router = Router();

router.get("/professionals", verifyToken, isAdmin, getProfessionalsByStatus);
// Mantenemos también /pending-professionals por compatibilidad redireccionando a PENDIENTE
router.get("/pending-professionals", verifyToken, isAdmin, (req, res) => {
  req.query.status = "PENDIENTE";
  return getProfessionalsByStatus(req, res);
});
router.patch("/professionals/:id/approve", verifyToken, isAdmin, approveProfessional);
router.patch("/professionals/:id/reject", verifyToken, isAdmin, rejectProfessional);

export default router;