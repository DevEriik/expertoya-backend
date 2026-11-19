import { Router } from "express";
import {
  crearResena,
  responderResena,
  uploadResenaFotosMiddleware,
} from "../controllers/review.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

// POST /api/reviews
// Solo clientes autenticados. Valida Closed-Loop y sube hasta 2 fotos a Supabase.
router.post(
  "/",
  authMiddleware(["CLIENTE"]),
  uploadResenaFotosMiddleware,
  crearResena
);

// POST /api/reviews/:id/reply
// Solo el profesional aludido. Registra réplica única si respuestaProfesional es null.
router.post("/:id/reply", authMiddleware(["PROFESIONAL"]), responderResena);

export default router;

