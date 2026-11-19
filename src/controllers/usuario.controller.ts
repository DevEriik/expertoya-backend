import { Response } from "express";
import { AuthRequest } from "../middlewares/auth.middleware";
import { prisma } from "../config/prisma";
import { subirArchivo } from "../services/storage.service";

/**
 * Endpoint para subir o actualizar la foto de perfil del usuario (cliente o profesional)
 * en Supabase Storage (carpeta 'avatares') y persistir la URL pública en la BD.
 */
export const subirFotoPerfil = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const file =
      req.file ||
      files?.["foto"]?.[0] ||
      files?.["foto_perfil"]?.[0];

    if (!file) {
      res.status(400).json({ error: "No se proporcionó ningún archivo de imagen" });
      return;
    }

    // Subir archivo al bucket de Supabase
    const publicUrl = await subirArchivo(file, "avatares");

    // Guardar URL en la entidad Usuario
    const updatedUser = await prisma.usuario.update({
      where: { id: userId },
      data: { foto_perfil: publicUrl },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        email: true,
        telefono: true,
        foto_perfil: true,
        rol: true,
      },
    });

    res.json({
      mensaje: "Foto de perfil actualizada exitosamente",
      foto_perfil: publicUrl,
      usuario: updatedUser,
    });
  } catch (error: any) {
    console.error("[subirFotoPerfil] Error:", error);
    res.status(500).json({
      error: "Error al subir foto de perfil",
      detalle: error.message || error,
    });
  }
};

