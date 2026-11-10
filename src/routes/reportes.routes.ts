import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { crearReporteDenuncia } from "../controllers/reportes.controller";

const router = Router();

router.use(verifyToken);

router.post("/crear", crearReporteDenuncia);

export default router;

