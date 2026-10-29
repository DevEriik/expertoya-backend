import { Router } from "express";
import {
  crearSolicitud,
  obtenerMisSolicitudes,
  obtenerSolicitudesRecibidas,
  actualizarEstadoSolicitud,
} from "../controllers/solicitud.controller";
import { verifyToken } from "../middlewares/auth.middleware";
const router = Router();

router.use(verifyToken);

router.post("/", crearSolicitud);
router.get("/mias", obtenerMisSolicitudes);

// 
router.get("/recibidas", obtenerSolicitudesRecibidas);

router.patch(
  "/:id/aceptar",
  (req, res, next) => {
    req.body.estado = "ACEPTADO";
    next();
  },
  actualizarEstadoSolicitud,
);

router.patch(
  "/:id/rechazar",
  (req, res, next) => {
    req.body.estado = "RECHAZADO";
    next();
  },
  actualizarEstadoSolicitud,
);

export default router;
