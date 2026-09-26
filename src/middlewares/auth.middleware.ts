import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";

export interface AuthRequest extends Request {
    user?: {
        userId: string;
        rol: string;
    };
}

export const verifyToken = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res
            .status(401)
            .json({ error: "Acceso denegado: Token no proporcionado" });
        return;
    }

    const token = authHeader.split(" ")[1];
    const secret = process.env.JWT_SECRET || "expertoya_clave_secreta_jwt_2026";
    const decoded = jwt.verify(token, secret) as {
        userId: string;
        rol: string;
    };

    const sesionActiva = await prisma.session.findUnique({ where: { token } });
    if (!sesionActiva || sesionActiva.expiresAt < new Date()) {
        res.status(401).json({ error: "Sesión inválida o expirada" });
        return;
    }

    req.user = decoded;
    next();
    } catch (error) {
        res.status(401).json({ error: "Token inválido o expirado" });
    }
};

export const isAdmin = (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): void => {
    if (!req.user || req.user.rol !== "ADMIN") {
        res.status(403).json({ error: "Acceso denegado: se requiere rol ADMIN" });
        return;
    }
    next();
};
