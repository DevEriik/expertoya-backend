import { Router } from "express";
import {
  getPendingProfessionals,
  approveProfessional,
  rejectProfessional,
} from "../controllers/admin.controller";

const router = Router();

// Endpoint libre para pruebas inmediatas
router.get("/pending-professionals", getPendingProfessionals);

router.patch("/professionals/:id/approve", approveProfessional);
router.patch("/professionals/:id/reject", rejectProfessional);

export default router;
git status