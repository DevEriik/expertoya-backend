import nodemailer, { Transporter } from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

interface TemplateOptions {
  badgeText: string;
  badgeBgColor?: string;
  badgeTextColor?: string;
  badgeBorderColor?: string;
  heading: string;
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
  extraNote?: string;
}

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

  private hasCredentials(): boolean {
    return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  }

  private getBaseTemplate(options: TemplateOptions): string {
    const {
      badgeText,
      badgeBgColor = "#ecfdf5",
      badgeTextColor = "#047857",
      badgeBorderColor = "#a7f3d0",
      heading,
      bodyHtml,
      ctaText,
      ctaUrl,
      extraNote,
    } = options;

    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ExpertoYa!</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 15px;">
          <tr>
            <td align="center">
              <!-- Contenedor Principal (Tarjeta blanca) -->
              <table role="presentation" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);" cellspacing="0" cellpadding="0">
                
                <!-- Barra Superior / Header Limpio con Logo Oficial -->
                <tr>
                  <td style="padding: 32px 40px 20px 40px; border-bottom: 1px solid #f1f5f9;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td>
                          <!-- Logo Estilo ExpertoYa -->
                          <table role="presentation" cellspacing="0" cellpadding="0">
                            <tr>
                              <td style="background-color: #ff7a00; color: #ffffff; font-weight: 900; font-size: 20px; width: 36px; height: 36px; text-align: center; border-radius: 8px; vertical-align: middle;">
                                E
                              </td>
                              <td style="padding-left: 10px; font-size: 24px; font-weight: 800; color: #ff7a00; letter-spacing: -0.5px;">
                                Experto<span style="color: #1e293b;">Ya!</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Cuerpo del Correo -->
                <tr>
                  <td style="padding: 36px 40px;">
                    
                    <!-- Badge Estilo Píldora Semántica -->
                    <div style="display: inline-block; background-color: ${badgeBgColor}; border: 1px solid ${badgeBorderColor}; color: ${badgeTextColor}; font-size: 12px; font-weight: 700; padding: 5px 14px; border-radius: 9999px; margin-bottom: 20px;">
                      ${badgeText}
                    </div>

                    <!-- Titular Principal Estilo Web -->
                    <h1 style="color: #1e293b; font-size: 26px; font-weight: 800; line-height: 1.3; margin: 0 0 18px 0; letter-spacing: -0.5px;">
                      ${heading}
                    </h1>

                    <!-- Contenido Dinámico -->
                    ${bodyHtml}

                    <!-- Botón Principal (si aplica) -->
                    ${
                      ctaText && ctaUrl
                        ? `
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 28px 0 20px 0;">
                          <tr>
                            <td align="center">
                              <a href="${ctaUrl}" target="_blank" style="display: inline-block; background-color: #ff7a00; color: #ffffff !important; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 34px; border-radius: 12px; box-shadow: 0 4px 10px rgba(255, 122, 0, 0.25);">
                                ${ctaText}
                              </a>
                            </td>
                          </tr>
                        </table>
                      `
                        : ""
                    }

                    <!-- Nota Adicional (si aplica) -->
                    ${
                      extraNote
                        ? `
                        <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 16px 0 0 0; text-align: center;">
                          ${extraNote}
                        </p>
                      `
                        : ""
                    }

                  </td>
                </tr>

                <!-- Footer Limpio Unificado -->
                <tr>
                  <td style="background-color: #f8fafc; padding: 24px 40px; text-align: center; border-top: 1px solid #f1f5f9;">
                    <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0;">
                      Has recibido este correo como parte de tu actividad en <strong>ExpertoYa!</strong>.<br />
                      &copy; ${new Date().getFullYear()} ExpertoYa - Neuquén, Plottier y Cipolletti.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }

  // 1. Correo de Bienvenida a Usuarios
  public async sendWelcomeEmail(email: string, nombre: string): Promise<void> {
    if (!this.hasCredentials()) {
      console.log(
        `[Email Service Simulado] Correo de bienvenida para: ${email} (${nombre})`,
      );
      return;
    }

    const html = this.getBaseTemplate({
      badgeText: "✨ Comunidad de Confianza y Calidad",
      badgeBgColor: "#ecfdf5",
      badgeTextColor: "#047857",
      badgeBorderColor: "#a7f3d0",
      heading: `¡Hola ${nombre}! <br />Tu cuenta ya está lista.`,
      bodyHtml: `
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
          Te damos la bienvenida a <strong>ExpertoYa!</strong>, la solución ágil y segura para conectar con los mejores oficios para tu hogar o para impulsar tu trabajo ofreciendo tus servicios a clientes de tu zona.
        </p>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; margin-bottom: 10px;">
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding-bottom: 14px;">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="font-size: 18px; vertical-align: top; width: 28px;">🔍</td>
                        <td style="font-size: 14px; color: #334155; line-height: 1.5;">
                          <strong>Para quienes necesitan arreglos:</strong> Encuentra profesionales certificados en plomería, electricidad, gas o carpintería con pagos resguardados y ubicación cercana.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td>
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="font-size: 18px; vertical-align: top; width: 28px;">🛠️</td>
                        <td style="font-size: 14px; color: #334155; line-height: 1.5;">
                          <strong>Para profesionales y expertos:</strong> Valida tu matrícula, publica tus trabajos con ayuda de nuestra IA y administra solicitudes de forma transparente.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `,
      ctaText: "Ingresar a la Plataforma",
      ctaUrl: "http://localhost:5173",
      extraNote:
        "Puedes acceder a tu cuenta tanto desde el navegador web como desde nuestra aplicación móvil.",
    });

    try {
      await this.transporter.sendMail({
        from: `"ExpertoYa!" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `¡Te damos la bienvenida a ExpertoYa!, ${nombre}`,
        text: `¡Hola ${nombre}!\n\nTe damos la bienvenida a ExpertoYa!, la plataforma donde encuentras especialistas de confianza para tu hogar y conectas con clientes de tu zona.\n\nTu cuenta ya está lista. Entra a http://localhost:5173 para empezar.\n\nEquipo de ExpertoYa © ${new Date().getFullYear()}`,
        html,
      });
      console.log(`[Email Service] Correo de bienvenida enviado a: ${email}`);
    } catch (error) {
      console.error(
        "[Email Service Error] No se pudo enviar el correo de bienvenida:",
        error,
      );
    }
  }

  // 2. Correo de Aprobación de Profesional
  public async sendApprovalEmail(to: string, nombre: string): Promise<void> {
    if (!this.hasCredentials()) {
      console.log(
        `[Email Service Simulado] Correo de aprobación para: ${to} (${nombre})`,
      );
      return;
    }

    const html = this.getBaseTemplate({
      badgeText: "✅ Perfil Profesional Acreditado",
      badgeBgColor: "#ecfdf5",
      badgeTextColor: "#047857",
      badgeBorderColor: "#a7f3d0",
      heading: `¡Felicitaciones, ${nombre}! <br />Tu perfil ha sido aprobado.`,
      bodyHtml: `
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
          Nos alegra informarte que nuestro equipo ha validado tu documentación exitosamente. Tu perfil profesional ya se encuentra <strong>activo y visible</strong> para todos los clientes en tu área.
        </p>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; margin-bottom: 10px;">
          <tr>
            <td>
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-size: 18px; vertical-align: top; width: 28px;">🛡️</td>
                  <td style="font-size: 14px; color: #334155; line-height: 1.5;">
                    <strong>Legajo verificado:</strong> Tus certificados de identidad, situación fiscal y habilitaciones oficiales cumplen con los estándares de seguridad de ExpertoYa.
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 18px; vertical-align: top; width: 28px; padding-top: 12px;">💼</td>
                  <td style="font-size: 14px; color: #334155; line-height: 1.5; padding-top: 12px;">
                    <strong>Listo para operar:</strong> Ya puedes ingresar a la app para publicar nuevos servicios y empezar a recibir solicitudes de clientes de tu zona.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `,
      ctaText: "Ir a mi Panel de Control",
      ctaUrl: "http://localhost:5173/login",
      extraNote:
        "Accede desde la aplicación móvil o el sitio web para gestionar tus servicios y solicitudes.",
    });

    try {
      await this.transporter.sendMail({
        from: `"ExpertoYa!" <${process.env.GMAIL_USER}>`,
        to,
        subject: "¡Tu perfil de ExpertoYa ha sido aprobado! 🎉",
        html,
      });
      console.log(`[Email Service] Correo de aprobación enviado a: ${to}`);
    } catch (error) {
      console.error(
        "[Email Service Error] No se pudo enviar el correo de aprobación:",
        error,
      );
    }
  }

  // 3. Correo de Rechazo / Corrección de Documentación
  public async sendRejectionEmail(
    to: string,
    nombre: string,
    motivo: string,
  ): Promise<void> {
    if (!this.hasCredentials()) {
      console.log(
        `[Email Service Simulado] Correo de rechazo para: ${to} (${nombre}) - Motivo: ${motivo}`,
      );
      return;
    }

    const html = this.getBaseTemplate({
      badgeText: "⚠️ Revisión de Legajo Requerida",
      badgeBgColor: "#fff7ed",
      badgeTextColor: "#c2410c",
      badgeBorderColor: "#fed7aa",
      heading: `Hola ${nombre}, <br />necesitamos que revises tu legajo.`,
      bodyHtml: `
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
          Durante la auditoría de tu perfil profesional, hemos detectado un inconveniente con los documentos enviados y tu legajo ha sido rechazado temporalmente.
        </p>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fff1f2; border: 1px solid #fecdd3; border-radius: 14px; padding: 20px; margin-bottom: 20px;">
          <tr>
            <td>
              <p style="margin: 0 0 6px 0; color: #9f1239; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                Motivo del rechazo:
              </p>
              <p style="margin: 0; color: #881337; font-size: 15px; line-height: 1.5; font-weight: 600;">
                ${motivo}
              </p>
            </td>
          </tr>
        </table>

        <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0;">
          Para activar tu perfil, ingresa nuevamente a la aplicación, corrige la documentación observada y vuelve a enviarla. Nuestro equipo la revisará a la brevedad.
        </p>
      `,
      ctaText: "Subir Nueva Documentación",
      ctaUrl: "http://localhost:5173/login",
      extraNote:
        "Si tienes dudas sobre qué documento subir, puedes comunicarte con el equipo de soporte.",
    });

    try {
      await this.transporter.sendMail({
        from: `"ExpertoYa!" <${process.env.GMAIL_USER}>`,
        to,
        subject: "Actualización sobre tu perfil de ExpertoYa ⚠️",
        html,
      });
      console.log(`[Email Service] Correo de rechazo enviado a: ${to}`);
    } catch (error) {
      console.error(
        "[Email Service Error] No se pudo enviar el correo de rechazo:",
        error,
      );
    }
  }

  // 4. Correo de Documentación de Onboarding Enviada
  public async sendOnboardingSubmittedEmail(
    to: string,
    nombre: string,
  ): Promise<void> {
    if (!this.hasCredentials()) {
      console.log(
        `[Email Service Simulado] Correo de onboarding enviado para: ${to} (${nombre})`,
      );
      return;
    }

    const html = this.getBaseTemplate({
      badgeText: "📄 Documentación en Revisión",
      badgeBgColor: "#eff6ff",
      badgeTextColor: "#1d4ed8",
      badgeBorderColor: "#bfdbfe",
      heading: `Hola ${nombre}, <br />recibimos tu documentación.`,
      bodyHtml: `
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
          Hemos recibido correctamente tus documentos de identidad, situación fiscal y constancias de oficio para operar en ExpertoYa.
        </p>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; margin-bottom: 20px;">
          <tr>
            <td>
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-size: 18px; vertical-align: top; width: 28px;">⏳</td>
                  <td style="font-size: 14px; color: #334155; line-height: 1.5;">
                    <strong style="color: #1e293b;">Estado:</strong> En cola de validación.<br />
                    <span style="color: #64748b; font-size: 13px;">Nuestro equipo de administración auditará tu legajo en menos de 24 horas hábiles. Te avisaremos apenas tu cuenta quede habilitada.</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0;">
          ¡Gracias por sumarte a la comunidad de profesionales de ExpertoYa!
        </p>
      `,
      ctaText: "Ir a la Aplicación",
      ctaUrl: "http://localhost:5173",
      extraNote:
        "Te notificaremos por correo electrónico ante cualquier actualización sobre tu solicitud.",
    });

    try {
      await this.transporter.sendMail({
        from: `"ExpertoYa!" <${process.env.GMAIL_USER}>`,
        to,
        subject:
          "¡Documentación recibida! Tu solicitud en ExpertoYa está en revisión 📄",
        html,
      });
      console.log(
        `[Email Service] Correo de onboarding recibido enviado a: ${to}`,
      );
    } catch (error) {
      console.error(
        "[Email Service Error] No se pudo enviar el correo de onboarding:",
        error,
      );
    }
  }

  // 5. Correo para Administradores por Nueva Solicitud
  public async sendAdminNewSolicitudEmail(
    adminEmail: string,
    profesionalNombre: string,
    profesionalEmail: string,
    oficios: string[],
  ): Promise<void> {
    if (!this.hasCredentials()) {
      console.log(
        `[Email Service Simulado] Correo para admin (${adminEmail}): Solicitud de ${profesionalNombre}`,
      );
      return;
    }

    const oficiosHtml =
      oficios.length > 0
        ? oficios
            .map(
              (o) =>
                `<li style="margin-bottom: 4px; color: #1e293b; font-weight: 600;">${o}</li>`,
            )
            .join("")
        : "<li>Ningún oficio especificado</li>";

    const html = this.getBaseTemplate({
      badgeText: "🔔 Auditoría Pendiente",
      badgeBgColor: "#fef3c7",
      badgeTextColor: "#b45309",
      badgeBorderColor: "#fde68a",
      heading: "Nueva solicitud de validación profesional",
      bodyHtml: `
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
          Un nuevo profesional ha completado el registro y cargado su documentación en la plataforma:
        </p>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; margin-bottom: 20px;">
          <tr>
            <td>
              <p style="margin: 0 0 6px 0; font-size: 14px; color: #334155;">
                <strong>Profesional:</strong> ${profesionalNombre}
              </p>
              <p style="margin: 0 0 12px 0; font-size: 14px; color: #334155;">
                <strong>Email:</strong> ${profesionalEmail}
              </p>
              <p style="margin: 0 0 6px 0; font-size: 14px; color: #334155;">
                <strong>Oficios postulados:</strong>
              </p>
              <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
                ${oficiosHtml}
              </ul>
            </td>
          </tr>
        </table>

        <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0;">
          Por favor, ingresa al panel de administración para auditar los documentos y aprobar o rechazar la solicitud.
        </p>
      `,
      ctaText: "Ir al Panel de Administración",
      ctaUrl: "http://localhost:5173/admin",
    });

    try {
      await this.transporter.sendMail({
        from: `"ExpertoYa!" <${process.env.GMAIL_USER}>`,
        to: adminEmail,
        subject: `Nueva solicitud de acreditación: ${profesionalNombre} 📋`,
        html,
      });
      console.log(
        `[Email Service] Notificación de admin enviada a: ${adminEmail}`,
      );
    } catch (error) {
      console.error(
        "[Email Service Error] No se pudo enviar el correo de admin:",
        error,
      );
    }
  }

  // 6. Correo de Recuperación de Contraseña
  public async sendPasswordResetEmail(
    to: string,
    nombre: string,
    resetToken: string,
    resetUrl: string,
  ): Promise<void> {
    if (!this.hasCredentials()) {
      console.log(
        `[Email Service Simulado] Correo de recuperación de contraseña para: ${to} (${nombre}) - Token: ${resetToken} - URL: ${resetUrl}`,
      );
      return;
    }

    const html = this.getBaseTemplate({
      badgeText: "🔐 Seguridad de tu Cuenta",
      badgeBgColor: "#fff7ed",
      badgeTextColor: "#c2410c",
      badgeBorderColor: "#fed7aa",
      heading: `Recupera tu contraseña, <br />${nombre}`,
      bodyHtml: `
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
          Hemos recibido una solicitud para restablecer la contraseña asociada a tu cuenta de <strong>ExpertoYa!</strong>.
        </p>

        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
          Para establecer una nueva clave de acceso, por favor haz clic en el botón de abajo:
        </p>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 14px; padding: 20px; margin: 20px 0; text-align: center;">
          <tr>
            <td align="center">
              <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                Código / Token de Seguridad para App Móvil
              </p>
              <div style="margin: 0; padding: 10px 14px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; display: inline-block; max-width: 100%;">
                <code style="color: #283593; font-size: 13px; font-weight: 700; word-break: break-all; letter-spacing: 0.5px;">
                  ${resetToken}
                </code>
              </div>
              <p style="margin: 10px 0 0 0; color: #94a3b8; font-size: 12px;">
                Si estás usando la aplicación móvil, puedes copiar este código en la pantalla de recuperación.
              </p>
            </td>
          </tr>
        </table>

        <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 20px 0 0 0;">
          Por razones de seguridad, este enlace y token tienen una validez de <strong>1 hora</strong>. Si no solicitaste este cambio, puedes ignorar este mensaje; tu contraseña actual continuará siendo segura.
        </p>
      `,
      ctaText: "Restablecer mi Contraseña",
      ctaUrl: resetUrl,
      extraNote:
        "Si tienes problemas con el botón, copia y pega el enlace o introduce el código directamente en la app.",
    });

    try {
      await this.transporter.sendMail({
        from: `"ExpertoYa!" <${process.env.GMAIL_USER}>`,
        to,
        subject: "Recuperación de contraseña - ExpertoYa! 🔐",
        text: `Hola ${nombre}!\n\nHemos recibido una solicitud para restablecer tu contraseña en ExpertoYa.\n\nPuedes restablecerla ingresando a este enlace:\n${resetUrl}\n\nO utilizando el token de seguridad en la aplicación:\n${resetToken}\n\nEste enlace expira en 1 hora. Si no realizaste la solicitud, ignora este mensaje.\n\nEquipo de ExpertoYa! © ${new Date().getFullYear()}`,
        html,
      });
      console.log(
        `[Email Service] Correo de recuperación de contraseña enviado a: ${to}`,
      );
    } catch (error) {
      console.error(
        "[Email Service Error] No se pudo enviar el correo de recuperación:",
        error,
      );
    }
  }
}

const emailService = EmailService.getInstance();

export const sendWelcomeEmail = (email: string, nombre: string) =>
  emailService.sendWelcomeEmail(email, nombre);

export const sendPasswordResetEmail = (
  to: string,
  nombre: string,
  resetToken: string,
  resetUrl: string,
) => emailService.sendPasswordResetEmail(to, nombre, resetToken, resetUrl);

export default emailService;

