import { Request, Response, Router } from "express";

const ESTADOS_RETORNO = ["success", "failure", "pending"] as const;
type EstadoRetorno = (typeof ESTADOS_RETORNO)[number];

const MENSAJES: Record<EstadoRetorno, string> = {
  success: "Pago procesado",
  failure: "Pago no completado",
  pending: "Pago en proceso",
};

const esEstadoRetorno = (value: string): value is EstadoRetorno =>
  (ESTADOS_RETORNO as readonly string[]).includes(value);

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Escapa texto para usarlo en HTML (contenido y atributos). */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Convierte un string en un literal seguro para incrustar dentro de <script>.
 * JSON.stringify escapa comillas y backslashes; además escapamos "<" para
 * que un valor no pueda cerrar el tag </script>.
 */
const toScriptLiteral = (value: string): string =>
  JSON.stringify(value).replace(/</g, "\\u003c");

/** Extrae el UUID de la solicitud desde "<uuid>-<timestamp>". */
const extraerSolicitudId = (externalReference: string): string => {
  const match = externalReference.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return match ? match[0] : "";
};

const paymentRedirectRouter = Router();

/**
 * Puente de retorno de Mercado Pago Checkout Pro.
 *
 * MP redirige el navegador a /pago/success, /pago/failure o /pago/pending.
 * Este handler valida el estado por el parámetro de ruta, arma un deep link
 * a la app mobile y responde con una página HTML que redirige automáticamente.
 */
paymentRedirectRouter.get("/:status", (req: Request, res: Response) => {
  const { status } = req.params;

  if (!esEstadoRetorno(status)) {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res
      .status(400)
      .type("html")
      .send(
        `<!doctype html><html lang="es"><head><meta charset="utf-8" />` +
          `<title>Retorno inválido</title></head><body>` +
          `<p>Estado de retorno inválido</p></body></html>`,
      );
    return;
  }

  const rawRef = asString(req.query.external_reference);
  const paymentId = asString(req.query.payment_id);
  const mpStatus = asString(req.query.status);
  const solicitudId = extraerSolicitudId(rawRef);

  let deepLinkUrl =
    `expertoyamovil://pago/${status}` +
    `?solicitudId=${encodeURIComponent(solicitudId)}` +
    `&solicitud_id=${encodeURIComponent(solicitudId)}` +
    `&external_reference=${encodeURIComponent(rawRef)}` +
    `&payment_id=${encodeURIComponent(paymentId)}`;

  if (mpStatus) {
    deepLinkUrl += `&mp_status=${encodeURIComponent(mpStatus)}`;
  }

  const deepLinkAttr = escapeHtml(deepLinkUrl);
  const deepLinkScript = toScriptLiteral(deepLinkUrl);
  const mensaje = MENSAJES[status];

  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(mensaje)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: #f8fafc;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #0f172a;
    }
    .card {
      width: 100%;
      max-width: 420px;
      padding: 32px 24px;
      text-align: center;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
    }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { margin: 0 0 24px; color: #64748b; font-size: 15px; }
    .btn {
      display: inline-block;
      padding: 14px 20px;
      border-radius: 10px;
      background: #2563eb;
      color: #ffffff;
      font-weight: 600;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>${escapeHtml(mensaje)}</h1>
    <p>Estamos volviendo a la aplicación...</p>
    <a href="${deepLinkAttr}" class="btn">Volver a la aplicación</a>
  </main>
  <script>window.location.replace(${deepLinkScript});</script>
</body>
</html>`;

  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.type("html").send(html);
});

export default paymentRedirectRouter;
