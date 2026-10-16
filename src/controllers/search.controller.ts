import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { haversineKm, estaDentroDeCobertura } from "../utils/geo";

export const buscarProfesionales = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { nombre, lat, lng, direccion, profesion, precioMin, precioMax, sort } =
    req.query as Record<string, string>;

  const latNum = lat ? Number(lat) : null;
  const lngNum = lng ? Number(lng) : null;
  const tieneCoords =
    latNum !== null && lngNum !== null && !isNaN(latNum) && !isNaN(lngNum);

  if (tieneCoords && !estaDentroDeCobertura(latNum!, lngNum!)) {
    res.status(200).json({
      fueraDeCobertura: true,
      mensaje:
        "Estás fuera de la zona de cobertura (Neuquén, Plottier, Cipolletti).",
      data: [],
    });
    return;
  }

  const where: any = {
    estado_validado: true,
    estado_auditoria: "APROBADO",
    disponible: true,
  };

  if (nombre) {
    where.OR = [
      { usuario: { nombre: { contains: nombre, mode: "insensitive" } } },
      { usuario: { apellido: { contains: nombre, mode: "insensitive" } } },
      { descripcion_perfil: { contains: nombre, mode: "insensitive" } },
    ];
  }
  if (direccion && !tieneCoords) {
    where.ubicacion_geografica = { contains: direccion, mode: "insensitive" };
  }
  if (profesion) {
    const idNum = Number(profesion);
    where.oficios =
      profesion.trim() !== "" && !isNaN(idNum)
        ? { some: { id: idNum } }
        : {
            some: {
              nombre_oficio: { contains: profesion, mode: "insensitive" },
            },
          };
  }
  if (precioMin || precioMax) {
    where.servicios_publicados = {
      some: {
        servicio_activo: true,
        costo_estimado: {
          ...(precioMin ? { gte: Number(precioMin) } : {}),
          ...(precioMax ? { lte: Number(precioMax) } : {}),
        },
      },
    };
  }

  const profesionales = await prisma.profesional.findMany({
    where,
    include: {
      usuario: {
        select: { id: true, nombre: true, apellido: true, foto_perfil: true },
      },
      oficios: true,
      servicios_publicados: {
        where: { servicio_activo: true },
        select: { costo_estimado: true },
      },
    },
  });

  let items = profesionales.map((p: any) => {
    const costos = (p.servicios_publicados ?? []).map((s: any) =>
      parseFloat(String(s.costo_estimado)),
    );
    const tarifaBase = costos.length ? Math.min(...costos) : null;
    const distanciaKm =
      tieneCoords && p.latitud != null && p.longitud != null
        ? haversineKm(latNum!, lngNum!, p.latitud, p.longitud)
        : null;
    return {
      _id: p.id,
      usuario: {
        _id: p.usuario.id,
        nombre: p.usuario.nombre,
        apellido: p.usuario.apellido,
        fotoPerfil: p.usuario.foto_perfil,
        calificacionPromedio: p.calificacion_promedio,
        ubicacion: { direccion: p.ubicacion_geografica },
      },
      profesiones: (p.oficios ?? []).map((o: any) => ({
        _id: o.id,
        nombre: o.nombre_oficio,
      })),
      descripcion: p.descripcion_perfil,
      tarifaBase,
      distanciaKm:
        distanciaKm !== null ? Number(distanciaKm.toFixed(2)) : undefined,
    };
  });

  items = items.filter((item: any) => {
    const orig = profesionales.find((x: any) => x.id === item._id) as any;
    if (orig.latitud == null || orig.longitud == null) return !tieneCoords;
    return estaDentroDeCobertura(orig.latitud, orig.longitud);
  });

  if (sort === "precio_asc") {
    items.sort(
      (a: any, b: any) =>
        (a.tarifaBase ?? Infinity) - (b.tarifaBase ?? Infinity),
    );
  } else {
    items.sort(
      (a: any, b: any) =>
        (a.distanciaKm ?? Infinity) - (b.distanciaKm ?? Infinity),
    );
  }

  res.status(200).json({ data: items, fueraDeCobertura: false });
};

export const listarProfesiones = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  const oficios = await prisma.oficio.findMany({ orderBy: { id: "asc" } });
  res.status(200).json({
    data: oficios.map((o) => ({
      _id: o.id,
      nombre: o.nombre_oficio,
      descripcion: o.descripcion_oficio,
    })),
  });
};
