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
      from: `"ExpertoYa" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "¡Bienvenido a ExpertoYa! Tu cuenta fue creada con éxito",
      html: `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; rounded: 8px;">
            <h2 style="color: #2563eb;">¡Hola ${nombre}!</h2>
            <p>Te damos la bienvenida a <strong>ExpertoYa</strong>, la plataforma donde conectas con profesionales de confianza para tu hogar.</p>
            <p>Ya puedes explorar los oficios disponibles y coordinar soluciones de forma rápida y segura.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="font-size: 12px; color: #777;">Equipo de ExpertoYa &copy; 2026</p>
            </div>
        `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`[Email Service] Correo de bienvenida enviado a: ${email}`);
  } catch (error) {
    console.error("[Email Service Error] No se pudo enviar el correo:", error);
  }
};
