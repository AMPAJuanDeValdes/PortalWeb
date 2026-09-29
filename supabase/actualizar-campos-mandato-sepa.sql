-- Ejecutar DESPUÉS de subir mandato-sepa-ampa.pdf desde
-- admin-sepa.html → pestaña "Plantilla y acreedor" → "Subir / reemplazar
-- plantilla" (página rellenable: 1).
--
-- Ese botón resetea "campos" a [] al subir el archivo, así que este
-- UPDATE coloca de golpe los 11 campos que rellena el socio (ya no hace
-- falta pasar por el editor de clics). Los datos del acreedor
-- (identificador, nombre, dirección, CP, país) ya están escritos
-- directamente en el propio PDF, así que no son "campos" — no hace
-- falta rellenarlos en la pestaña de acreedor para que el documento
-- funcione (aunque no está de más guardarlos ahí también, solo a
-- efectos de tenerlos a mano en el panel).

update mandato_sepa_config
set campos = '[
  {"id": "ref_mandato",          "tipo": "ref_mandato",         "xPct": 37.78, "yPct": 14.49},
  {"id": "nombre",                "tipo": "nombre",              "xPct": 10.08, "yPct": 43.94},
  {"id": "apellidos",             "tipo": "apellidos",           "xPct": 50.38, "yPct": 43.94},
  {"id": "direccion",             "tipo": "direccion",           "xPct": 10.08, "yPct": 47.49},
  {"id": "cp_ciudad_provincia",   "tipo": "cp_ciudad_provincia", "xPct": 10.08, "yPct": 51.05},
  {"id": "pais_deudor",           "tipo": "pais_deudor",         "xPct": 10.08, "yPct": 55.21},
  {"id": "swift_bic",             "tipo": "swift_bic",           "xPct": 10.08, "yPct": 60.32},
  {"id": "iban",                  "tipo": "iban",                "xPct": 10.08, "yPct": 65.06},
  {"id": "fecha_hoy",             "tipo": "fecha_hoy",           "xPct": 23.51, "yPct": 72.42},
  {"id": "localidad",             "tipo": "texto",               "xPct": 47.02, "yPct": 72.42},
  {"id": "firma",                 "tipo": "firma",               "xPct": 23.51, "yPct": 77.77}
]'::jsonb,
    pagina_rellenable = 1,
    identificador_acreedor = 'ES23ZZZG79659173',
    nombre_acreedor = 'Apa Del Colegio Evangelico Juan De Valdes',
    direccion_acreedor = 'Av. de Canillejas a Vicálvaro 135',
    cp_acreedor = '28022, Madrid, Madrid',
    pais_acreedor = 'España',
    updated_at = now()
where id = 1;
