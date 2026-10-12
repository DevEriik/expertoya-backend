import { supabase } from "../config/supabase";

const BUCKET = "archivos";

/**
 * Sube un archivo al bucket de Supabase Storage y devuelve su URL pública.
 * @param file El archivo recibido por Multer (en memoria)
 * @param carpeta Subcarpeta dentro del bucket, ej: "profesionales"
 * @returns URL pública del archivo subido
 */
export const subirArchivo = async (
  file: Express.Multer.File,
  carpeta: string = "profesionales"
): Promise<string> => {
  const extension = file.originalname.split(".").pop();
  const nombreUnico = `${carpeta}/${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}.${extension}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(nombreUnico, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (error) {
    console.error("[Supabase Storage] Error al subir archivo:", error.message);
    throw new Error(`Error al subir el archivo ${file.fieldname}: ${error.message}`);
  }

  const { data: publicData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(data.path);

  return publicData.publicUrl;
};
