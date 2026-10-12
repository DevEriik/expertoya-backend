import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export const sendWelcomeEmail = async (email: string, nombre: string) => {
  try {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      console.log(
        `[Email Service Simulado] Correo de bienvenida para: ${email} (${nombre})`,
      );
      return;
    }

    const mailOptions = {
      from: `"ExpertoYa!" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `¡Te damos la bienvenida a ExpertoYa!, ${nombre}`,
      text: `¡Hola ${nombre}!\n\nTe damos la bienvenida a ExpertoYa!, la plataforma donde encuentras especialistas de confianza para tu hogar y conectas con clientes de tu zona.\n\nTu cuenta ya está lista. Entra a https://expertoya.com para empezar.\n\nEquipo de ExpertoYa © 2026`,
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Bienvenido a ExpertoYa</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 15px;">
            <tr>
              <td align="center">
                <!-- Contenedor Principal (Tarjeta blanca) -->
                <table role="presentation" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);" cellspacing="0" cellpadding="0">
                  
                  <!-- Barra Superior / Header Limpio con Logo -->
                  <tr>
                    <td style="padding: 32px 40px 20px 40px; border-bottom: 1px solid #f1f5f9;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                        <tr>
                          <td>
                            <!-- Logo Estilo Navbar ExpertoYa -->
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
                      
                      <!-- Badge Estilo Píldora IA -->
                      <div style="display: inline-block; background-color: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; font-size: 12px; font-weight: 700; padding: 5px 14px; border-radius: 9999px; margin-bottom: 20px;">
                        ✨ Comunidad de Confianza y Calidad
                      </div>

                      <!-- Titular Principal Estilo Web -->
                      <h1 style="color: #1e293b; font-size: 28px; font-weight: 800; line-height: 1.25; margin: 0 0 16px 0; letter-spacing: -0.5px;">
                        ¡Hola ${nombre}! <br />
                        Tu cuenta ya está lista.
                      </h1>

                      <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 28px 0;">
                        Te damos la bienvenida a <strong>ExpertoYa!</strong>, la solución ágil y segura para conectar con los mejores oficios para tu hogar, o para impulsar tu trabajo ofreciendo tus servicios a clientes de tu zona.
                      </p>

                      <!-- Tarjeta de Beneficios Compartidos -->
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 22px; margin-bottom: 30px;">
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

                      <!-- Botón Principal estilo 'Contratar' de la web -->
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                        <tr>
                          <td align="center">
                            <a href="http://localhost:5173" target="_blank" style="display: inline-block; background-color: #ff7a00; color: #ffffff; font-size: 16px; font-weight: 700; text-decoration: none; padding: 14px 34px; border-radius: 12px; box-shadow: 0 4px 10px rgba(255, 122, 0, 0.25);">
                              Ingresar a la Plataforma
                            </a>
                          </td>
                        </tr>
                      </table>

                      <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0; text-align: center;">
                        Puedes acceder a tu cuenta tanto desde el navegador web como desde nuestra aplicación móvil.
                      </p>

                    </td>
                  </tr>

                  <!-- Footer Limpio -->
                  <tr>
                    <td style="background-color: #f8fafc; padding: 24px 40px; text-align: center; border-top: 1px solid #f1f5f9;">
                      <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0;">
                        Has recibido este correo como confirmación de tu registro en <strong>ExpertoYa!</strong>.<br />
                        &copy; 2026 ExpertoYa - Neuquén, Plottier y Cipolletti.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`[Email Service] Correo de bienvenida enviado a: ${email}`);
  } catch (error) {
    console.error("[Email Service Error] No se pudo enviar el correo:", error);
  }
};
