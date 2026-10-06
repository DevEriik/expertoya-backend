import { Router } from "express";
import { register, login, logout, updateProfile } from "../controllers/auth.controller";
import {
    verifyToken,
    isAdmin,
    AuthRequest,
} from "../middlewares/auth.middleware";


const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", verifyToken, logout);
router.put("/profile", verifyToken, updateProfile);

import { prisma } from "../config/prisma";

router.get("/me", verifyToken, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user?.userId },
            select: { nombre: true, apellido: true, telefono: true, foto_perfil: true, email: true, rol: true }
        });
        res.json({ usuarioAutenticado: user });
    } catch (e) {
        res.status(500).json({ error: "Error fetch user" });
    }
});
router.get("/admin-check", verifyToken, isAdmin, (req: AuthRequest, res) => {
    res.json({ mensaje: "Acceso de Administrador verificado correctamente" });
});


export default router;
