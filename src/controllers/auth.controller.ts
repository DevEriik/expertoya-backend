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
        fecha_nacimiento,
        matricula_documento,
        descripcion_perfil,
        } = req.body;

        if (!fecha_nacimiento) {
            res.status(400).json({ error: "La fecha de nacimiento es obligatoria" });
            return;
        }

        const birthDate = new Date(fecha_nacimiento);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }

        if (age < 18) {
            res.status(403).json({ error: "Debes ser mayor de 18 años para registrarte en la plataforma" });
            return;
        }

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
            fecha_nacimiento: birthDate,
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

export const updateProfile = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "No autorizado" });

        const { nombre, apellido, telefono, foto_perfil } = req.body;
        
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { nombre, apellido, telefono, foto_perfil }
        });
        
        res.json(updatedUser);
    } catch (error: any) {
        res.status(500).json({ error: "Error al actualizar perfil", detalle: error.message || error });
    }
};
