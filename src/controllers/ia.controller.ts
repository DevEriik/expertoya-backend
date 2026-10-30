import { Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";

let aiInstance: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY no está configurada en las variables de entorno del servidor.");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

const MODELOS: string[] = (
  process.env.GEMINI_MODELS ??
  process.env.GEMINI_MODEL ??
  "gemini-2.5-flash,gemini-2.0-flash,gemini-1.5-flash,gemini-3.5-flash,gemini-3.1-flash-lite"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function generarConFallback(partsToSend: any[], temperature: number = 0.3) {
  let ultimoError: any = null;
  const ai = getAIClient();

  for (const model of MODELOS) {
    for (let intento = 1; intento <= 2; intento++) {
      try {
        console.log(
          `Enviando consulta a Gemini (${model}), intento ${intento}...`,
        );
        return await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: partsToSend }],
          config: { responseMimeType: "application/json", temperature },
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
    if (imagen) (imagen as any).buffer = null;
  }
};

/**
 * Lista de términos ofensivos, discriminatorios o inapropiados para filtro previo.
 */
const PALABRAS_OFENSIVAS = [
  "mierda", "pelotudo", "pelotuda", "boludo de mierda", "hijo de puta",
  "hija de puta", "puto", "puta", "concha de tu madre", "conchudo",
  "conchuda", "forro", "forra", "tarado", "tarada", "imbecil", "estafador",
  "estafadora", "estafa", "robo", "droga", "cocaina", "marihuana", "armas",
  "sicario", "matar", "asesinar", "violacion", "nazi", "racista", "discriminacion", "odio"
];

function contieneTerminosInapropiados(texto: string): boolean {
  const normalizado = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return PALABRAS_OFENSIVAS.some((palabra) => {
    const palabraNorm = palabra
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return normalizado.includes(palabraNorm);
  });
}

/**
 * Motor de redacción comercial dinámico de contingencia.
 * Genera textos comerciales persuasivos y variados cuando la API de Gemini no cuenta con clave configurada o está temporalmente saturada.
 */
function generarDescripcionComercialLocal(
  titulo: string,
  categoria: string,
  descripcionActual: string = ""
): string {
  const opciones = [
    // Opción 1: Enfoque resolutivo y de tranquilidad
    `¿Buscás una solución definitiva y garantizada para ${titulo}? Como profesionales especializados en ${categoria}, cuidamos cada detalle para ofrecerte un trabajo prolijo, puntual y con materiales de primera línea. Contactanos hoy mismo para coordinar una visita y resolverlo sin demoras.`,

    // Opción 2: Enfoque con viñetas de valor
    `Servicio profesional y calificado de ${titulo}:\n• Diagnóstico honesto y evaluación detallada.\n• Materiales de alta resistencia y herramientas de precisión.\n• Cumplimiento estricto de normas de seguridad en ${categoria}.\n¡Escribinos y coordinamos el horario que te quede más cómodo!`,

    // Opción 3: Enfoque técnico y de experiencia
    `Especialistas en ${categoria}: llevamos a cabo trabajos de ${titulo} con amplia trayectoria en el rubro. Nos enfocamos en diagnósticos certeros que van a la raíz del problema, asegurando terminaciones impecables y resultados que perduran en el tiempo. Atención personalizada y garantía de satisfacción.`,

    // Opción 4: Enfoque cercano para el hogar
    `Tu tranquilidad y la de tu hogar son nuestra prioridad. Brindamos servicio integral de ${titulo} con máxima prolijidad, orden y respeto por tus espacios. Brindamos asesoramiento claro de principio a fin para que tomes la mejor decisión sin sobrecostos. Consultanos sin compromiso.`,

    // Opción 5: Enfoque ágil y de respuesta rápida
    `¿Necesitás resolver ${titulo} de forma ágil, segura y con mano de obra experta? Brindamos cobertura rápida en trabajos de ${categoria}, garantizando puntualidad y ejecución impecable bajo los más exigentes estándares técnicos. ¡Escribinos para agendar tu servicio a la brevedad!`,

    // Opción 6: Enfoque de garantía y terminaciones
    `Garantizá el óptimo funcionamiento de tus instalaciones con nuestro servicio de ${titulo}. Nos caracterizamos por la dedicación en cada terminación y el uso exclusivo de insumos homologados en ${categoria}. Trabajo 100% garantizado por escrito y presupuesto accesible.`,

    // Opción 7: Enfoque preventivo y asesoramiento
    `Evitá dolores de cabeza futuros: realizamos ${titulo} con evaluación técnica exhaustiva. Detectamos y resolvemos cada detalle con herramientas profesionales para asegurar una intervención segura, eficiente y duradera en ${categoria}. ¡Escribinos para coordinar tu consulta hoy mismo!`
  ];

  const opcionesDisponibles = opciones.filter(
    (opc) => opc.trim().toLowerCase() !== descripcionActual.trim().toLowerCase()
  );
  const listaFinal = opcionesDisponibles.length > 0 ? opcionesDisponibles : opciones;

  return listaFinal[Math.floor(Math.random() * listaFinal.length)];
}

/**
 * POST /api/ia/generate-description
 * Endpoint para generar propuestas de redacción comercial persuasivas para servicios de ExpertoYa.
 */
export const generateDescription = async (req: Request, res: Response) => {
  let tituloLimpio = "";
  let categoriaLimpia = "";

  try {
    const { titulo, categoria, descripcion_actual } = req.body || {};

    if (!titulo || typeof titulo !== "string" || !titulo.trim()) {
      return res.status(400).json({
        error: "El título del servicio es requerido para redactar la descripción.",
      });
    }

    if (!categoria || typeof categoria !== "string" || !categoria.trim()) {
      return res.status(400).json({
        error: "La categoría del servicio es requerida para contextualizar la propuesta.",
      });
    }

    tituloLimpio = titulo.trim();
    categoriaLimpia = categoria.trim();
    const descripcionActualLimpia = typeof descripcion_actual === "string" ? descripcion_actual.trim() : "";

    const textoCompleto = `${tituloLimpio} ${categoriaLimpia}`;
    if (contieneTerminosInapropiados(textoCompleto)) {
      return res.status(400).json({
        error: "El contenido ingresado contiene términos ofensivos, inapropiados o discriminatorios no permitidos.",
      });
    }

    const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();

    if (!apiKey) {
      console.warn(
        "Aviso: GEMINI_API_KEY no detectada en .env. Utilizando generador comercial dinámico de respaldo."
      );
      const fallbackLocal = generarDescripcionComercialLocal(
        tituloLimpio,
        categoriaLimpia,
        descripcionActualLimpia
      );
      return res.status(200).json({
        descripcion: fallbackLocal,
        motor: "contingencia",
      });
    }

    const contextoVariacion = descripcionActualLimpia
      ? `\nREGLA DE VARIACIÓN OBLIGATORIA: El usuario ya tiene este texto en pantalla: "${descripcionActualLimpia}". Genera una propuesta RADICALMENTE DIFERENTE en gancho, estructura y palabras de apertura para que tenga una alternativa fresca.\n`
      : "";

    const prompt = `Actúa como un redactor publicitario senior y especialista en marketing digital para "ExpertoYa", la plataforma líder de oficios y servicios técnicos en Argentina.

Tu objetivo es crear una propuesta de descripción comercial, persuasiva y convincente para el siguiente servicio publicado por un profesional:
- Título del servicio: "${tituloLimpio}"
- Categoría / Oficio: "${categoriaLimpia}"${contextoVariacion}

REGLAS ESTRICTAS DE REDACCIÓN Y SEGURIDAD:
1. ENFOQUE COMERCIAL Y PERSUASIVO:
   - Redacta un texto vendedor, claro y profesional que genere máxima confianza e invite al cliente a contratar de inmediato.
   - Enfatiza experiencia, puntualidad, diagnóstico riguroso, uso de herramientas profesionales y garantía de trabajo bien hecho.
   - REGLA ESTRICTA: NO incluyas montos numéricos, tarifas ni precios en el texto de la descripción. El precio ya se visualiza por separado en la interfaz.
2. ALEATORIO Y NO ESTÁTICO (DIVERSIDAD CREATIVA):
   - Cada redacción debe ser única y original. Varía la estructura y los ganchos comerciales. Evita plantillas repetitivas o acartonadas.
3. CALIDAD LINGÜÍSTICA:
   - Español natural (estilo rioplatense/latinoamericano profesional). Absolutamente libre de faltas ortográficas o problemas de concordancia.
   - Longitud ideal: 2 a 3 oraciones contundentes o 1 párrafo de entre 50 y 85 palabras.
4. FILTRO ESTRICTO DE SEGURIDAD (TOLERANCIA CERO):
   - Prohibido de manera explícita e intransigente incluir lenguaje vulgar, soez, ofensivo, difamatorio, violento o discriminatorio por motivos de raza, género, religión o nacionalidad.
   - Si los datos provistos denotan contenido inapropiado o ilícito, responde ÚNICAMENTE: {"error": "contenido_inapropiado"}
5. FORMATO DE SALIDA ESTRICTO:
   - Responde EXCLUSIVAMENTE con un JSON válido con la siguiente clave:
   {"descripcion": "texto de la propuesta comercial aquí"}
   No agregues explicaciones adicionales, ni introducciones ni código Markdown fuera del JSON.`;

    const partsToSend = [{ text: prompt }];

    const response = await generarConFallback(partsToSend, 0.75);

    let parsedResponse: any;
    try {
      const rawText = (response.text || "").trim();
      const cleaned = rawText
        .replace(/^```json/i, "")
        .replace(/^```/, "")
        .replace(/```$/, "")
        .trim();
      parsedResponse = JSON.parse(cleaned);
    } catch (parseError) {
      console.warn("No se pudo parsear como JSON directo, usando texto limpio:", parseError);
      if (response.text && response.text.trim().length > 10) {
        const fallbackText = response.text
          .replace(/[{}"\\]/g, "")
          .replace(/^descripcion:\s*/i, "")
          .trim();
        return res.status(200).json({ descripcion: fallbackText });
      }
      return res.status(500).json({
        error: "No fue posible estructurar la respuesta del asistente de IA.",
      });
    }

    if (parsedResponse.error === "contenido_inapropiado") {
      return res.status(400).json({
        error: "El servicio no cumple con las normas de seguridad de contenido de ExpertoYa.",
      });
    }

    const descripcionFinal =
      parsedResponse.descripcion ||
      parsedResponse.description ||
      parsedResponse.texto;

    if (!descripcionFinal || typeof descripcionFinal !== "string" || !descripcionFinal.trim()) {
      return res.status(500).json({
        error: "La IA no pudo generar una descripción adecuada en este intento.",
      });
    }

    return res.status(200).json({
      descripcion: descripcionFinal.trim(),
    });
  } catch (error: any) {
    console.error("Error en generateDescription ->", error?.status || error?.code, error?.message || error);

    if (tituloLimpio && categoriaLimpia) {
      console.warn("Recurriendo al generador de contingencia tras fallo en API de Gemini.");
      const fallbackLocal = generarDescripcionComercialLocal(
        tituloLimpio,
        categoriaLimpia
      );
      return res.status(200).json({
        descripcion: fallbackLocal,
        aviso: "Propuesta generada mediante motor de respaldo por saturación de servicio externo.",
      });
    }

    if (error?.status === 429) {
      return res.status(429).json({
        error: "El asistente de IA se encuentra momentáneamente saturado. Por favor intenta en un instante.",
      });
    }

    return res.status(500).json({
      error: "Error interno en el servicio de IA al generar la propuesta comercial.",
    });
  }
};