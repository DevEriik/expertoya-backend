import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { AuthRequest } from "../middlewares/auth.middleware";
import {
  sendWelcomeEmail,
  sendPasswordResetEmail,
} from "../services/email.service";

const esMayorDeEdad = (fechaNacimientotxt: string): boolean => {
  const fechaNac = new Date(fechaNacimientotxt);
  if (isNaN(fechaNac.getTime())) return false;
  const hoy = new Date();
  let edad = hoy.getFullYear() - fechaNac.getFullYear();
  const mes = hoy.getMonth() - fechaNac.getMonth();
  if (mes < 0 || (mes === 0 && hoy.getDate() < fechaNac.getDate())) {
    edad--;
  }
  return edad >= 18;
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      email,
      password,
      rol,
      nombre,
      apellido,
      telefono,
      fecha_nacimiento,
      foto_perfil,
      matricula_documento,
      descripcion_perfil,
    } = req.body;
    
    if (!email || !password || !nombre || !apellido || !fecha_nacimiento) {
      res
        .status(400)
        .json({ error: "Faltan campos obligatorios para el registro" });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({
        error: "El formato del correo electrónico ingresado no es válido.",
      });
      return;
    }

    if (!esMayorDeEdad(fecha_nacimiento)) {
      res.status(400).json({
        error: "Debes ser mayor de 18 años para operar en ExpertoYa.",
      });
      return;
    }

    const rolesPermitidos = ["CLIENTE", "PROFESIONAL"];
    const rolUsuario: any = rolesPermitidos.includes(rol) ? rol : "CLIENTE";

    const usuarioExistente = await prisma.usuario.findUnique({
      where: { email },
    });

    if (usuarioExistente) {
      res.status(400).json({ error: "El correo ya está registrado" });
      return;
    }

    const password_hash = await bcrypt.hash(password, 10);

    const nuevoUsuario = await prisma.usuario.create({
      data: {
        email,
        password_hash,
        nombre,
        apellido,
        telefono,
        foto_perfil,
        fecha_nacimiento: new Date(fecha_nacimiento),
        rol: rolUsuario,
        ...(rolUsuario === "PROFESIONAL" && {
          profesional: {
            create: {
              matricula_documento,
              descripcion_perfil,
              estado_validado: false,
            },
          },
        }),
      },
      include: { profesional: true },
    });

    // Enviar correo de bienvenida
    await sendWelcomeEmail(nuevoUsuario.email, nuevoUsuario.nombre);

    res.status(201).json({
      mensaje: "Usuario registrado exitosamente",
      usuario: {
        id: nuevoUsuario.id,
        email: nuevoUsuario.email,
        nombre: nuevoUsuario.nombre,
        apellido: nuevoUsuario.apellido,
        rol: nuevoUsuario.rol,
        profesional: nuevoUsuario.profesional,
      },
    });
  } catch (error: any) {
    console.error("Error en registrar:", error);
    res.status(500).json({
      error: "Error interno al procesar el registro",
      detalle: error.message || error,
    });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, plataforma } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Correo y contraseña son requeridos" });
      return;
    }

    const usuario = await prisma.usuario.findUnique({
      where: { email },
      include: { profesional: true },
    });

    if (!usuario || !(await bcrypt.compare(password, usuario.password_hash))) {
      res.status(401).json({ error: "Credenciales inválidas" });
      return;
    }

    const secret = process.env.JWT_SECRET || "expertoya_clave_secreta_jwt_2026";
    const token = jwt.sign({ userId: usuario.id, rol: usuario.rol }, secret, {
      expiresIn: "7d",
    });

    const fechaExpiracion = new Date();
    fechaExpiracion.setDate(fechaExpiracion.getDate() + 7);

    await prisma.sesion.create({
      data: {
        usuario_id: usuario.id,
        token,
        plataforma: plataforma || "WEB",
        expiresAt: fechaExpiracion,
      },
    });

    res.json({
      mensaje: "Inicio de sesión exitoso",
      token,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        rol: usuario.rol,
        profesional: usuario.profesional,
      },
    });
  } catch (error: any) {
    console.error("Error en login:", error);
    res
      .status(500)
      .json({ error: "Error interno al procesar el inicio de sesión" });
  }
};

export const logout = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (token) {
      await prisma.sesion.deleteMany({ where: { token } });
    }

    res.json({ mensaje: "Sesión cerrada correctamente" });
  } catch (error: any) {
    res
      .status(500)
      .json({ error: "Error interno al procesar el cierre de sesión" });
  }
};

export const updateProfile = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "No autorizado" });
      return;
    }

    const { nombre, apellido, telefono, foto_perfil } = req.body;

    const updatedUser = await prisma.usuario.update({
      where: { id: userId },
      data: { nombre, apellido, telefono, foto_perfil },
    });

    res.json(updatedUser);
  } catch (error: any) {
    res.status(500).json({
      error: "Error al actualizar perfil",
      detalle: error.message || error,
    });
  }
};

export const forgotPassword = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: "El correo electrónico es requerido." });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({
        error: "El formato del correo electrónico ingresado no es válido.",
      });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const usuario = await prisma.usuario.findUnique({
      where: { email: cleanEmail },
    });

    if (!usuario) {
      res.status(404).json({
        error:
          "No existe ninguna cuenta registrada con este correo electrónico.",
      });
      return;
    }

    const secret =
      process.env.JWT_SECRET || "expertoya_clave_secreta_jwt_2026";
    const resetToken = jwt.sign(
      { userId: usuario.id, email: usuario.email, type: "password_reset" },
      secret,
      { expiresIn: "1h" },
    );

    const frontendUrl =
      process.env.FRONTEND_URL || "http://localhost:5173";
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    await sendPasswordResetEmail(
      usuario.email,
      usuario.nombre,
      resetToken,
      resetUrl,
    );

    res.status(200).json({
      mensaje:
        "Se ha enviado un correo con las instrucciones para restablecer tu contraseña.",
      token: resetToken,
    });
  } catch (error: any) {
    console.error("Error en forgotPassword:", error);
    res.status(500).json({
      error: "Error interno al procesar la solicitud de recuperación.",
      detalle: error.message || error,
    });
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      res.status(400).json({
        error: "El token de seguridad y la nueva contraseña son obligatorios.",
      });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({
        error: "La contraseña debe tener al menos 8 caracteres.",
      });
      return;
    }

    const secret =
      process.env.JWT_SECRET || "expertoya_clave_secreta_jwt_2026";

    let decoded: any;
    try {
      decoded = jwt.verify(token, secret);
    } catch (jwtErr: any) {
      res.status(400).json({
        error:
          "El token de recuperación es inválido o ha expirado. Por favor solicita uno nuevo.",
      });
      return;
    }

    if (decoded.type !== "password_reset" || !decoded.userId) {
      res.status(400).json({
        error: "El token proporcionado no es válido para restablecer contraseña.",
      });
      return;
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: decoded.userId },
    });

    if (!usuario) {
      res.status(404).json({
        error: "El usuario asociado a esta solicitud no existe.",
      });
      return;
    }

    const password_hash = await bcrypt.hash(password, 10);

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { password_hash },
    });

    // Invalida las sesiones existentes del usuario por seguridad
    await prisma.sesion.deleteMany({
      where: { usuario_id: usuario.id },
    });

    res.status(200).json({
      mensaje:
        "Tu contraseña ha sido restablecida con éxito. Ya puedes iniciar sesión con tu nueva clave.",
    });
  } catch (error: any) {
    console.error("Error en resetPassword:", error);
    res.status(500).json({
      error: "Error interno al restablecer la contraseña.",
      detalle: error.message || error,
    });
  }
};

