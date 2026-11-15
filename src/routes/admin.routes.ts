import { Router } from "express";
import {
  getProfessionalsByStatus,
  approveProfessional,
  rejectProfessional,
  getReportesDenuncia,
  getReporteDenunciaDetalle,
  resolverReporteDenuncia,
  getBitacoraBloqueos,
} from "../controllers/admin.controller";
import { verifyToken, isAdmin } from "../middlewares/auth.middleware";

const router = Router();

router.get("/professionals", verifyToken, isAdmin, getProfessionalsByStatus);
router.get("/pending-professionals", verifyToken, isAdmin, (req, res) => {
  req.query.status = "PENDIENTE";
  return getProfessionalsByStatus(req, res);
});
router.patch("/professionals/:id/approve", verifyToken, isAdmin, approveProfessional);
router.patch("/professionals/:id/reject", verifyToken, isAdmin, rejectProfessional);

router.get("/reportes", verifyToken, isAdmin, getReportesDenuncia);
router.get("/reportes/:id", verifyToken, isAdmin, getReporteDenunciaDetalle);
router.patch("/reportes/:id/resolver", verifyToken, isAdmin, resolverReporteDenuncia);

router.get("/bloqueos", verifyToken, isAdmin, getBitacoraBloqueos);

export default router;
