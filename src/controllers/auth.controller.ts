import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";

export const register = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
        email,
        password,
        rol,
        nombre,
        apellido,
        telefono,
        foto_perfil,
        matricula_documento,
        descripcion_perfil,
        } = req.body;

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
        res.status(400).json({ error: "El correo ya está registrado" });
        return;
        }

        const password_hash = await bcrypt.hash(password, 10);
        const userRole = rol || "CLIENTE";

        const newUser = await prisma.user.create({
        data: {
            email,
            password_hash,
            nombre,
            apellido,
            telefono,
            foto_perfil,
            rol: userRole,
            ...(userRole === "PROFESIONAL" && {
            profile: {
                create: {
                matricula_documento,
                descripcion_perfil,
                },
            },
            }),
        },
        include: { profile: true },
        });

        res.status(201).json({
        mensaje: "Usuario registrado exitosamente",
        usuario: {
            id: newUser.id,
            email: newUser.email,
            nombre: newUser.nombre,
            apellido: newUser.apellido,
            rol: newUser.rol,
            profesional: newUser.profile,
        },
        });
    } catch (error: any) {
        console.error("Error en register:", error);
        res.status(500).json({
        error: "Error al registrar usuario",
        detalle: error.message || error,
        });
    }
    };

    export const login = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password, plataforma } = req.body;

        const user = await prisma.user.findUnique({
        where: { email },
        include: { profile: true },
        });

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        res.status(401).json({ error: "Credenciales inválidas" });
        return;
        }

        const secret = process.env.JWT_SECRET || "expertoya_clave_secreta_jwt_2026";
        const token = jwt.sign({ userId: user.id, rol: user.rol }, secret, {
        expiresIn: "7d",
        });

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await prisma.session.create({
        data: {
            usuario_id: user.id,
            token,
            plataforma: plataforma || "WEB",
            expiresAt,
        },
        });

        res.json({
        mensaje: "Inicio de sesión exitoso",
        token,
        usuario: {
            id: user.id,
            email: user.email,
            nombre: user.nombre,
            apellido: user.apellido,
            rol: user.rol,
            profesional: user.profile,
        },
        });
    } catch (error: any) {
        console.error("Error en login:", error);
        res.status(500).json({
        error: "Error al iniciar sesión",
        detalle: error.message || error,
        });
    }
    };

    export const logout = async (
    req: AuthRequest,
    res: Response,
    ): Promise<void> => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (token) {
        await prisma.session.deleteMany({ where: { token } });
        }
        res.json({ mensaje: "Sesión cerrada correctamente" });
    } catch (error: any) {
        res.status(500).json({
        error: "Error al cerrar sesión",
        detalle: error.message || error,
        });
    }
};
