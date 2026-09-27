import { Router } from "express";
import {
    getPendingProfessionals,
    approveProfessional,
    rejectProfessional,
} from "../controllers/admin.controller";
import { verifyToken, isAdmin } from "../middlewares/auth.middleware";

const router = Router();

router.use(verifyToken, isAdmin);

router.get("/pending-professionals", getPendingProfessionals);

router.patch("/professionals/:id/approve", approveProfessional);

router.patch("/professionals/:id/reject", rejectProfessional);

export default router;
