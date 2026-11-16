import { Router } from "express";
import multer from "multer";
import {
    register,
    login,
    logout,
    updateProfile,
    forgotPassword,
    resetPassword,
} from "../controllers/auth.controller";
import {
    verifyToken,
    isAdmin,
    AuthRequest,
} from "../middlewares/auth.middleware";

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});

router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/logout", verifyToken, logout);
router.put(
    "/profile",
    verifyToken,
    upload.fields([
        { name: "foto_perfil", maxCount: 1 },
        { name: "foto", maxCount: 1 },
    ]),
    updateProfile
);

import { prisma } from "../config/prisma";

router.get("/me", verifyToken, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.usuario.findUnique({
            where: { id: req.user?.userId },
            select: { id: true, nombre: true, apellido: true, telefono: true, foto_perfil: true, email: true, rol: true }
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
