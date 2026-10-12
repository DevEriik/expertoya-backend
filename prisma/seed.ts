import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OFICIOS_SEED = [
  { id: 1, nombre_oficio: 'Plomero / Fontanero', descripcion_oficio: 'Instalación y reparación de cañerías, grifería y artefactos sanitarios.' },
  { id: 2, nombre_oficio: 'Gasista Matriculado', descripcion_oficio: 'Instalaciones de gas domiciliarias y comerciales habilitadas por Camuzzi.' },
  { id: 3, nombre_oficio: 'Electricista', descripcion_oficio: 'Instalaciones eléctricas, tableros y mantenimiento matriculado.' },
  { id: 4, nombre_oficio: 'Pintor', descripcion_oficio: 'Pintura de interiores, exteriores y acabados decorativos.' },
  { id: 5, nombre_oficio: 'Cerrajero', descripcion_oficio: 'Apertura de urgencia, cerraduras digitales y cambio de combinación.' },
  { id: 6, nombre_oficio: 'Refrigeración', descripcion_oficio: 'Instalación, carga de gas y mantenimiento de acondicionadores de aire.' },
  { id: 7, nombre_oficio: 'Albañilería', descripcion_oficio: 'Construcción en seco, refacciones de mampostería y revoques.' },
  { id: 8, nombre_oficio: 'Carpintero', descripcion_oficio: 'Fabricación y reparación de aberturas, muebles y estructuras de madera.' },
];

async function main() {
  console.log('🌱 Iniciando carga de oficios...');

  for (const oficio of OFICIOS_SEED) {
    await prisma.oficio.upsert({
      where: { id: oficio.id },
      update: {
        nombre_oficio: oficio.nombre_oficio,
        descripcion_oficio: oficio.descripcion_oficio,
      },
      create: oficio,
    });
  }

  // Ajustar la secuencia de Postgres al valor máximo
  try {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"oficio"', 'id'), coalesce(max(id), 1)) FROM "oficio";`
    );
  } catch (e) {
    console.warn('Nota: No se pudo ajustar la secuencia de Postgres automáticamente:', e);
  }

  console.log('✅ Oficios cargados exitosamente:');
  const oficiosEnDb = await prisma.oficio.findMany();
  console.table(oficiosEnDb);
}

main()
  .catch((e) => {
    console.error('Error durante el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
