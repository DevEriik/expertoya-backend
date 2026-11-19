import { supabase } from "../config/supabase";

const BUCKET = "archivos";

/**
 * Sube un buffer al bucket de Supabase Storage y devuelve su URL pública.
 * Pensado para archivos generados en memoria (por ejemplo, un PDF con pdfkit).
 *
 * @param buffer Contenido del archivo.
 * @param nombreArchivo Ruta dentro del bucket, ej: "comprobantes/pago-123.pdf".
 * @param contentType MIME type del archivo.
 * @returns URL pública del archivo subido.
 */
export const subirBuffer = async (
  buffer: Buffer,
  nombreArchivo: string,
  contentType: string = "application/octet-stream",
): Promise<string> => {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(nombreArchivo, buffer, { contentType, upsert: true });

  if (error) {
    console.error("[Supabase Storage] Error al subir buffer:", error.message);
    throw new Error(`Error al subir el archivo ${nombreArchivo}: ${error.message}`);
  }

  const { data: publicData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(data.path);

  return publicData.publicUrl;
};

/**
 * Sube un archivo recibido por Multer y devuelve su URL pública.
 * @param file El archivo recibido por Multer (en memoria)
 * @param carpeta Subcarpeta dentro del bucket, ej: "profesionales"
 * @returns URL pública del archivo subido
 */
export const subirArchivo = async (
  file: Express.Multer.File,
  carpeta: string = "profesionales",
): Promise<string> => {
  const extension = file.originalname?.split(".").pop() || "pdf";
  const sanitizedFieldName = file.fieldname || "documento";
  const nombreUnico = `${carpeta}/${sanitizedFieldName}-${Date.now()}-${Math.round(Math.random() * 1e9)}.${extension}`;

  return subirBuffer(
    file.buffer,
    nombreUnico,
    file.mimetype ||
      (extension.toLowerCase() === "pdf" ? "application/pdf" : "image/jpeg"),
  );
};
