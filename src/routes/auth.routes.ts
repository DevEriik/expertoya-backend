import { Router } from "express";
import { register, login, logout } from "../controllers/auth.controller";
import {
    verifyToken,
    isAdmin,
    AuthRequest,
} from "../middlewares/auth.middleware";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", verifyToken, logout);

router.get("/me", verifyToken, (req: AuthRequest, res) => {
    res.json({ usuarioAutenticado: req.user });
});

router.get("/admin-check", verifyToken, isAdmin, (req: AuthRequest, res) => {
    res.json({ mensaje: "Acceso de Administrador verificado correctamente" });
});

export default router;
