import { Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODELOS: string[] = (
  process.env.GEMINI_MODELS ??
  process.env.GEMINI_MODEL ??
  "gemini-3.5-flash,gemini-3.1-flash-lite"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function generarConFallback(partsToSend: any[]) {
  let ultimoError: any = null;

  for (const model of MODELOS) {
    for (let intento = 1; intento <= 2; intento++) {
      try {
        console.log(
          `Enviando consulta a Gemini (${model}), intento ${intento}...`,
        );
        return await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: partsToSend }],
          config: { responseMimeType: "application/json", temperature: 0.3 },
        });
      } catch (e: any) {
        ultimoError = e;
        const status = e?.status ?? e?.code;
        console.error(`Error Gemini (${model}) -> status: ${status}`);

        if (status === 404 || status === 429) break;
        if (status === 503 || status === 500) {
          if (intento < 2) await dormir(1500);
          continue;
        }
        throw e;
      }
    }
  }
  throw ultimoError;
}

const construirEnlace = (oficio: string) =>
  `/busqueda?oficio=${encodeURIComponent(oficio)}`;

export const analizarProblemaVisual = async (req: Request, res: Response) => {
  const imagen = req.file;

  try {
    const descripcion: string = (req.body?.descripcion ?? req.body?.texto ?? "")
      .toString()
      .trim();

    if (!imagen && !descripcion) {
      return res
        .status(400)
        .json({ error: "Por favor, adjunta una foto o describe el problema." });
    }

    const contextoUsuario = descripcion
      ? `El usuario describe el problema así: "${descripcion}".\n`
      : "";

    const prompt = `Actúa como un experto en oficios y reparaciones domésticas de Argentina.
${contextoUsuario}
Analiza la situación (imagen, texto o ambos) y determina qué profesionales podrían resolverla.

Reglas estrictas:
1. Si hay una imagen y está borrosa, movida, demasiado oscura o tapada, y el texto no alcanza para entender el problema, devuelve EXACTAMENTE: {"error": "imagen_borrosa"}
2. Si no es un problema doméstico o no hay información útil, devuelve EXACTAMENTE: {"error": "imagen_invalida"}
3. En cualquier otro caso devuelve un JSON con esta forma:
{"resumen": "descripción breve del problema en una frase", "oficios": ["Plomero", "Albañil"], "urgente": false, "advertencia": ""}
  - "oficios": entre 1 y 3 oficios, del más al menos probable. Usa nombres simples como Plomero, Electricista, Gasista, Albañil, Pintor, Carpintero, Cerrajero, Techista, Herrero, Técnico en aire acondicionado, Jardinero.
  - "urgente": true solo si hay riesgo (olor a gas, chispas, cables expuestos, filtración grave). En ese caso "advertencia" explica brevemente qué hacer de inmediato.
Devuelve SOLO JSON válido, sin texto extra.`;

    const partsToSend: any[] = [];

    if (imagen) {
      partsToSend.push({
        inlineData: {
          mimeType: imagen.mimetype,
          data: imagen.buffer.toString("base64"),
        },
      });
    }
    partsToSend.push({ text: prompt });

    const response = await generarConFallback(partsToSend);

    let parsedResponse: any;
    try {
      parsedResponse = JSON.parse(response.text || "{}");
    } catch {
      return res
        .status(502)
        .json({ error: "La IA devolvió una respuesta inválida." });
    }

    if (parsedResponse.error === "imagen_borrosa") {
      return res.status(400).json({
        codigo: "imagen_borrosa",
        error:
          "La foto salió borrosa u oscura. Probá de nuevo con más luz, más cerca del problema y sin mover el celular.",
      });
    }
    if (parsedResponse.error) {
      return res.status(400).json({
        codigo: "imagen_invalida",
        error:
          "No pudimos identificar un problema doméstico en la foto. Probá con otra imagen o describí qué está pasando.",
      });
    }

    const oficios: string[] = Array.from(
      new Set(
        (Array.isArray(parsedResponse.oficios) ? parsedResponse.oficios : [])
          .map((o: unknown) => String(o).trim())
          .filter(Boolean),
      ),
    ).slice(0, 3) as string[];

    if (oficios.length === 0) {
      return res.status(400).json({
        codigo: "imagen_invalida",
        error:
          "No pudimos identificar qué oficio necesitás. Probá con otra foto o describí el problema.",
      });
    }

    return res.status(200).json({
      oficios_sugeridos: oficios,
      oficios: oficios.map((nombre) => ({
        nombre,
        enlace: construirEnlace(nombre),
      })),
      resumen: parsedResponse.resumen ?? null,
      urgente: !!parsedResponse.urgente,
      advertencia: parsedResponse.advertencia || null,
    });
  } catch (error: any) {
    console.error(
      "Error Gemini -> status:",
      error?.status,
      "| mensaje:",
      error?.message,
    );

    if (error?.status === 429) {
      return res.status(429).json({
        error:
          "La IA está recibiendo muchas consultas en este momento. Probá de nuevo en un minuto.",
      });
    }
    if (error?.status === 503) {
      return res.status(503).json({
        error: "La IA está saturada. Probá de nuevo en unos minutos.",
      });
    }
    if (error?.status === 404 || error?.message?.includes("not found")) {
      return res.status(502).json({
        error: "Servicio de IA temporalmente no disponible (Error 404).",
      });
    }

    return res
      .status(500)
      .json({ error: "Error interno analizando la imagen." });
  } finally {
    // Privacidad: la imagen solo vivió en memoria; se descarta siempre
    if (imagen) (imagen as any).buffer = null;
  }
};
