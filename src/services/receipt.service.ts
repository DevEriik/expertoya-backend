import crypto from "crypto";
import PDFDocument from "pdfkit";
import { format } from "date-fns";
import { subirBuffer } from "./storage.service";

/**
 * Datos necesarios para emitir el comprobante digital de una transacción.
 * Los montos llegan ya formateados para desacoplar el PDF de Prisma.Decimal.
 */
export interface ComprobantePagoData {
  pagoId: string;
  solicitudId: string;
  mpPaymentId: string | null;
  estadoPago: string;
  servicioTitulo: string;
  moneda: string;
  montoTotal: string;
  comisionPlataforma: string;
  comisionPorcentaje: string;
  feeMp: string;
  netoProfesional: string;
  fechaEmision: Date;
  clienteNombre: string;
  clienteEmail: string;
  profesionalNombre: string;
  profesionalEmail: string;
}

export interface ComprobanteGenerado {
  url: string;
  numero: string;
  hash: string;
  generadoEn: Date;
}

const ANCHO_ETIQUETA = 150;
const X_ETIQUETA = 50;
const X_VALOR = 210;
const ANCHO_VALOR = 330;

export class ReceiptService {
  /**
   * Genera el PDF en memoria y lo sube a Supabase Storage.
   */
  async generarComprobantePago(
    data: ComprobantePagoData,
  ): Promise<ComprobanteGenerado> {
    const buffer = await this.construirComprobantePdf(data);
    const numero = `CMP-${data.pagoId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");

    const url = await subirBuffer(
      buffer,
      `comprobantes/${numero}.pdf`,
      "application/pdf",
    );

    return { url, numero, hash, generadoEn: new Date() };
  }

  /**
   * Construye el PDF y devuelve el buffer. Público para poder probarlo
   * sin subir nada a Supabase.
   */
  construirComprobantePdf(data: ComprobantePagoData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Encabezado
      doc
        .fillColor("#0f172a")
        .font("Helvetica-Bold")
        .fontSize(22)
        .text("ExpertoYa", X_ETIQUETA, 50);

      doc
        .fillColor("#64748b")
        .font("Helvetica")
        .fontSize(11)
        .text("Comprobante digital de pago", X_ETIQUETA, 78);

      doc
        .moveTo(X_ETIQUETA, 100)
        .lineTo(545, 100)
        .strokeColor("#cbd5e1")
        .stroke();

      let y = 118;
      y = this.escribirPar(doc, "N° de comprobante", `CMP-${data.pagoId.slice(0, 10).toUpperCase()}`, y);
      y = this.escribirPar(
        doc,
        "Fecha de emisión",
        format(data.fechaEmision, "dd/MM/yyyy HH:mm"),
        y,
      );
      y = this.escribirPar(doc, "Estado", data.estadoPago, y);
      y = this.escribirPar(
        doc,
        "ID de operación MP",
        data.mpPaymentId ?? "No informado",
        y,
      );

      y = this.escribirSeccion(doc, "Servicio", y);
      y = this.escribirPar(doc, "Solicitud", data.solicitudId, y);
      y = this.escribirPar(doc, "Servicio", data.servicioTitulo, y);

      y = this.escribirSeccion(doc, "Partes", y);
      y = this.escribirPar(
        doc,
        "Cliente",
        `${data.clienteNombre} (${data.clienteEmail})`,
        y,
      );
      y = this.escribirPar(
        doc,
        "Profesional",
        `${data.profesionalNombre} (${data.profesionalEmail})`,
        y,
      );

      y = this.escribirSeccion(doc, "Detalle económico", y);
      y = this.escribirPar(
        doc,
        "Monto total",
        `${data.moneda} ${data.montoTotal}`,
        y,
      );
      y = this.escribirPar(
        doc,
        `Comisión ExpertoYa (${data.comisionPorcentaje}%)`,
        `${data.moneda} ${data.comisionPlataforma}`,
        y,
      );
      y = this.escribirPar(
        doc,
        "Fee Mercado Pago",
        `${data.moneda} ${data.feeMp}`,
        y,
      );
      y = this.escribirPar(
        doc,
        "Neto profesional",
        `${data.moneda} ${data.netoProfesional}`,
        y,
      );

      doc
        .moveTo(X_ETIQUETA, y + 6)
        .lineTo(545, y + 6)
        .strokeColor("#cbd5e1")
        .stroke();

      doc
        .fillColor("#475569")
        .font("Helvetica-Oblique")
        .fontSize(9)
        .text(
          "El dinero permanece retenido por ExpertoYa hasta que el cliente y el profesional confirmen la finalización del servicio.",
          X_ETIQUETA,
          y + 20,
          { width: 495 },
        );

      doc
        .fillColor("#94a3b8")
        .font("Helvetica")
        .fontSize(8)
        .text(
          `Documento generado automáticamente. Pago: ${data.pagoId}`,
          X_ETIQUETA,
          770,
          { width: 495, align: "center" },
        );

      doc.end();
    });
  }

  private escribirSeccion(
    doc: PDFKit.PDFDocument,
    titulo: string,
    y: number,
  ): number {
    doc
      .fillColor("#0f172a")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text(titulo, X_ETIQUETA, y + 8);
    return y + 30;
  }

  private escribirPar(
    doc: PDFKit.PDFDocument,
    etiqueta: string,
    valor: string,
    y: number,
  ): number {
    doc
      .fillColor("#64748b")
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(etiqueta, X_ETIQUETA, y, { width: ANCHO_ETIQUETA });

    doc
      .fillColor("#0f172a")
      .font("Helvetica")
      .fontSize(10)
      .text(valor, X_VALOR, y, { width: ANCHO_VALOR });

    const altoEtiqueta = doc.heightOfString(etiqueta, {
      width: ANCHO_ETIQUETA,
    });
    const altoValor = doc.heightOfString(valor, { width: ANCHO_VALOR });

    return y + Math.max(altoEtiqueta, altoValor) + 8;
  }
}

export const receiptService = new ReceiptService();
