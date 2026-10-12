import nodemailer, { Transporter } from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

class EmailService {
    private transporter: Transporter;
    private static instance: EmailService;

    private constructor() {
        this.transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD,
            },
        });
    }

    public static getInstance(): EmailService {
        if (!EmailService.instance) {
            EmailService.instance = new EmailService();
        }
        return EmailService.instance;
    }

    public async sendApprovalEmail(to: string, nombre: string): Promise<void> {
        const subject = "¡Tu perfil de ExpertoYa ha sido aprobado! 🎉";
        const html = this.getApprovalTemplate(nombre);

        await this.transporter.sendMail({
            from: `"ExpertoYa!" <${process.env.GMAIL_USER}>`,
            to,
            subject,
            html,
        });
    }

    public async sendRejectionEmail(to: string, nombre: string, motivo: string): Promise<void> {
        const subject = "Actualización sobre tu perfil de ExpertoYa ⚠️";
        const html = this.getRejectionTemplate(nombre, motivo);

        await this.transporter.sendMail({
            from: `"ExpertoYa!" <${process.env.GMAIL_USER}>`,
            to,
            subject,
            html,
        });
    }

    public async sendOnboardingSubmittedEmail(to: string, nombre: string): Promise<void> {
        const subject = "¡Documentación recibida! Tu solicitud en ExpertoYa está en revisión 📄";
        const html = this.getOnboardingSubmittedTemplate(nombre);

        await this.transporter.sendMail({
            from: `"ExpertoYa!" <${process.env.GMAIL_USER}>`,
            to,
            subject,
            html,
        });
    }

    public async sendAdminNewSolicitudEmail(
        adminEmail: string,
        profesionalNombre: string,
        profesionalEmail: string,
        oficios: string[]
    ): Promise<void> {
        const subject = `Nueva solicitud de acreditación: ${profesionalNombre} 📋`;
        const html = this.getAdminNewSolicitudTemplate(profesionalNombre, profesionalEmail, oficios);

        await this.transporter.sendMail({
            from: `"ExpertoYa!" <${process.env.GMAIL_USER}>`,
            to: adminEmail,
            subject,
            html,
        });
    }

    private getBaseTemplate(title: string, body: string, isSuccess: boolean): string {
        const accentColor = isSuccess ? "#10B981" : "#EF4444"; // Success o Danger Semántico
        return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;700;800&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'Plus Jakarta Sans', sans-serif;
            background-color: #FDFCF4; /* Crema Fondo */
            color: #283593; /* Índigo Texto */
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 40px auto;
            background-color: #ffffff;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
            overflow: hidden;
            border-top: 6px solid #FF8C00; /* Naranja Marca */
          }
          .header {
            background-color: #121826; /* Dark Mode Fondo Base */
            padding: 30px 40px;
            text-align: center;
          }
          .header h1 {
            color: #FF8C00;
            font-weight: 800;
            margin: 0;
            font-size: 28px;
          }
          .content {
            padding: 40px;
          }
          .title {
            color: ${accentColor};
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 20px;
          }
          .text {
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 20px;
          }
          .box {
            background-color: #F9FAFB;
            border-left: 4px solid ${accentColor};
            padding: 15px 20px;
            margin: 20px 0;
            border-radius: 0 8px 8px 0;
          }
          .footer {
            background-color: #FDFCF4;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #6B7280;
            border-top: 1px solid #E5E7EB;
          }
          .btn {
            display: inline-block;
            background-color: #00BFA5; /* Teal Acento */
            color: white !important;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 700;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>ExpertoYa!</h1>
          </div>
          <div class="content">
            <h2 class="title">${title}</h2>
            ${body}
          </div>
          <div class="footer">
            © ${new Date().getFullYear()} ExpertoYa. Todos los derechos reservados.<br>
            Este es un correo automático, por favor no respondas a esta dirección.
          </div>
        </div>
      </body>
      </html>
    `;
    }

    private getApprovalTemplate(nombre: string): string {
        const title = "✅ ¡Bienvenido a la red de Expertos!";
        const body = `
      <p class="text">Hola <strong>${nombre}</strong>,</p>
      <p class="text">Nos alegra informarte que nuestro equipo ha validado tu documentación exitosamente. Tu perfil profesional ya se encuentra <strong>activo y visible</strong> para todos los clientes en tu área.</p>
      <p class="text">Ya puedes ingresar a la app para empezar a recibir solicitudes de trabajo y ofrecer tus servicios.</p>
      <center><a href="https://expertoya.com/login" class="btn">Ir a mi Panel de Control</a></center>
    `;
        return this.getBaseTemplate(title, body, true);
    }

    private getRejectionTemplate(nombre: string, motivo: string): string {
        const title = "⚠️ Necesitamos que revises tu legajo";
        const body = `
      <p class="text">Hola <strong>${nombre}</strong>,</p>
      <p class="text">Durante la auditoría de tu perfil profesional, hemos detectado un inconveniente con los documentos enviados y tu legajo ha sido rechazado temporalmente.</p>
      <div class="box">
        <p style="margin: 0;"><strong>Motivo del rechazo:</strong></p>
        <p style="margin: 10px 0 0 0; color: #283593;">${motivo}</p>
      </div>
      <p class="text">Para activar tu perfil, por favor ingresa nuevamente a la aplicación y carga la documentación corregida.</p>
      <center><a href="https://expertoya.com/login" style="background-color: #FF8C00;" class="btn">Subir nueva documentación</a></center>
    `;
        return this.getBaseTemplate(title, body, false);
    }

    private getOnboardingSubmittedTemplate(nombre: string): string {
        const title = "📄 Documentación en proceso de revisión";
        const body = `
      <p class="text">Hola <strong>${nombre}</strong>,</p>
      <p class="text">Hemos recibido correctamente tus documentos de identidad, situación fiscal y constancias de oficio para operar en ExpertoYa.</p>
      <div class="box">
        <p style="margin: 0; color: #283593;"><strong>Estado:</strong> En cola de validación</p>
        <p style="margin: 5px 0 0 0; font-size: 14px; color: #4B5563;">Nuestro equipo de administración auditará tu legajo en menos de 24 horas hábiles. Te enviaremos un correo apenas tu cuenta quede habilitada.</p>
      </div>
      <p class="text">¡Gracias por sumarte a la comunidad de profesionales de ExpertoYa!</p>
    `;
        return this.getBaseTemplate(title, body, true);
    }

    private getAdminNewSolicitudTemplate(
        nombre: string,
        email: string,
        oficios: string[]
    ): string {
        const title = "🔔 Nueva solicitud de validación profesional";
        const oficiosHtml = oficios.length > 0
            ? oficios.map((o) => `<li>${o}</li>`).join("")
            : "<li>Ningún oficio especificado</li>";

        const body = `
      <p class="text">Un nuevo profesional ha completado el registro y subido sus documentos:</p>
      <div class="box">
        <p style="margin: 0;"><strong>Profesional:</strong> ${nombre}</p>
        <p style="margin: 5px 0 0 0;"><strong>Email:</strong> ${email}</p>
        <p style="margin: 10px 0 0 0;"><strong>Oficios postulados:</strong></p>
        <ul style="margin: 5px 0 0 0; padding-left: 20px; color: #283593;">
          ${oficiosHtml}
        </ul>
      </div>
      <p class="text">Por favor, ingresa al panel de administración para auditar los documentos y aprobar o rechazar la solicitud.</p>
      <center><a href="http://localhost:5173/admin" class="btn">Ir al Panel de Administración</a></center>
    `;
        return this.getBaseTemplate(title, body, false);
    }
}

export default EmailService.getInstance();
