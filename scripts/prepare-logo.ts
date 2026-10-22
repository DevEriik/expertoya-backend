import fs from "fs";
import path from "path";
import sharp from "sharp";
import { supabase } from "../src/config/supabase";

async function main() {
  const svgPath = path.resolve(
    __dirname,
    "../../../frontend/expertoya-web/src/assets/logos/logo-expertoya-light.svg"
  );
  const outputPngPath = path.resolve(
    __dirname,
    "../src/assets/logo-expertoya-light.png"
  );

  console.log("Leyendo SVG de:", svgPath);
  const svgBuffer = fs.readFileSync(svgPath);

  // Convertir SVG a PNG de alta resolución (ancho 482px, alto 120px) con fondo transparente
  console.log("Generando PNG con sharp...");
  const pngBuffer = await sharp(svgBuffer)
    .resize(482, 120, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ quality: 100 })
    .toBuffer();

  fs.writeFileSync(outputPngPath, pngBuffer);
  console.log("PNG guardado localmente en:", outputPngPath, "Tamaño:", pngBuffer.length, "bytes");

  // Subir a Supabase Storage en bucket 'archivos' para tener URL pública permanente
  console.log("Subiendo a Supabase Storage en branding/logo-expertoya-light.png...");
  const { data, error } = await supabase.storage
    .from("archivos")
    .upload("branding/logo-expertoya-light.png", pngBuffer, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) {
    console.error("Error al subir a Supabase Storage:", error.message);
  } else {
    console.log("Logo subido a Supabase Storage:", data);
  }

  const { data: publicData } = supabase.storage
    .from("archivos")
    .getPublicUrl("branding/logo-expertoya-light.png");

  console.log("URL publica del logo:", publicData.publicUrl);
}

main().catch(console.error);
