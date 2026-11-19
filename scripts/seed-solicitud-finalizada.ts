import "dotenv/config";
import {
  EstadoAuditoria,
  EstadoPago,
  EstadoSolicitud,
  Role,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../src/config/prisma";

async function main() {
  console.log("🛠️  Creando escenario interactivo de prueba para Tarea 17 (Reseñas Closed-Loop)...\n");

  const passwordHash = await bcrypt.hash("123456", 10);

  // 1. Oficio
  let oficio = await prisma.oficio.findFirst();
  if (!oficio) {
    oficio = await prisma.oficio.create({
      data: {
        nombre_oficio: "Electricista",
        descripcion_oficio: "Instalaciones eléctricas y reparaciones",
      },
    });
  }

  // 2. Cliente de prueba
  let cliente = await prisma.usuario.findUnique({
    where: { email: "cliente.review@expertoya.com" },
  });
  if (!cliente) {
    cliente = await prisma.usuario.create({
      data: {
        email: "cliente.review@expertoya.com",
        password_hash: passwordHash,
        nombre: "Lucas",
        apellido: "García",
        rol: Role.CLIENTE,
      },
    });
  }

  // 3. Profesional de prueba
  let usuarioPro = await prisma.usuario.findUnique({
    where: { email: "pro.review@expertoya.com" },
  });
  if (!usuarioPro) {
    usuarioPro = await prisma.usuario.create({
      data: {
        email: "pro.review@expertoya.com",
        password_hash: passwordHash,
        nombre: "Roberto",
        apellido: "Pérez",
        rol: Role.PROFESIONAL,
      },
    });
  }

  let pro = await prisma.profesional.findUnique({
    where: { id: usuarioPro.id },
  });
  if (!pro) {
    pro = await prisma.profesional.create({
      data: {
        id: usuarioPro.id,
        estado_validado: true,
        estado_auditoria: EstadoAuditoria.APROBADO,
        ubicacion_geografica: "Neuquén Capital",
        descripcion_perfil: "Técnico especialista en instalaciones seguras con más de 8 años de trayectoria.",
        calificacionPromedio: 0,
        totalResenas: 0,
        oficios: { connect: { id: oficio.id } },
      },
    });
  }

  // 4. Servicio publicado
  let servicio = await prisma.servicioPublicado.findFirst({
    where: { profesional_id: pro.id },
  });
  if (!servicio) {
    servicio = await prisma.servicioPublicado.create({
      data: {
        profesional_id: pro.id,
        oficio_id: oficio.id,
        titulo_servicio: "Reparación de Tablero Eléctrico",
        descripcion_servicio: "Diagnóstico, reemplazo de térmicas y certificación.",
        costo_estimado: 28000,
        duracion_estimada: "1 hora",
      },
    });
  }

  // 5. Solicitud FINALIZADA y LIBERADA (lista para calificar)
  const solicitud = await prisma.solicitudTrabajo.create({
    data: {
      cliente_id: cliente.id,
      servicio_id: servicio.id,
      fecha_solicitada: new Date(),
      monto_acordado: 28000,
      estado_solicitud_trabajo: EstadoSolicitud.FINALIZADO,
      descripcion: "Revisión completa de disyuntor y llaves térmicas en domicilio.",
      franja_horaria: "Tarde (14:00 - 18:00)",
      pagos: {
        create: {
          monto_total: 28000,
          comision_plataforma: 2800,
          estado_pago: EstadoPago.LIBERADO,
          fecha_liberacion: new Date(),
        },
      },
    },
    include: { pagos: true },
  });

  console.log("=================================================================");
  console.log("✅ ESCENARIO CREADO EXITOSAMENTE PARA PRUEBAS UI Y API");
  console.log("=================================================================");
  console.log(`👤 CLIENTE PARA CALIFICAR:`);
  console.log(`   Email:    cliente.review@expertoya.com`);
  console.log(`   Password: 123456`);
  console.log(`\n👨‍🔧 PROFESIONAL:`);
  console.log(`   Email:    pro.review@expertoya.com`);
  console.log(`   Password: 123456`);
  console.log(`   ID:       ${pro.id}`);
  console.log(`\n📋 SOLICITUD LISTA PARA CALIFICAR (FINALIZADA + LIBERADA):`);
  console.log(`   Solicitud ID: ${solicitud.id}`);
  console.log("=================================================================\n");
}

main()
  .catch((e) => {
    console.error("Error al generar escenario:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

