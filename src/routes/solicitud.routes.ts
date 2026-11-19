import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import {
    crearSolicitud,
    obtenerSolicitudesCliente,
    obtenerSolicitudesProfesional,
    responderSolicitud,
} from "../controllers/solicitudes.controller";

const router = Router();

router.use(verifyToken);

router.post("/", crearSolicitud);

router.get("/mias", obtenerSolicitudesCliente);

router.get("/recibidas", obtenerSolicitudesProfesional);

router.patch("/:id/responder", responderSolicitud);

export default router;
