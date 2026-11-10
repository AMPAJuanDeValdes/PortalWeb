// Documentos ya preparados para rellenar y firmar: el PDF (en assets/documentos)
// y dónde va cada dato. En el panel (Eventos → Documentos → «Usar un documento
// preparado») se añaden a un evento sin tener que marcar los campos a mano.
// Los usa también la página de prueba en local (herramientas/prueba-documentos.html).
//
// Los datos salen de la web (alumno/a, adulto socio o no socio): la familia solo firma.
// Si cambia el documento, se cambian aquí el PDF y las posiciones (en % de la página).

var PLANTILLAS_DOCUMENTOS = [
  {
    id: 'cabalgata-2027-autorizacion',
    titulo: 'Autorización de menores (Cabalgata 2027)',
    archivo: 'assets/documentos/cabalgata-2027-autorizacion-menores.pdf',
    aplica_a: 'pareja',          // un alumno/a con el adulto que le acompaña
    pagina: 4,                   // la página con el formulario (1 a 3: normas)
    campos: [
      {"id": "tutor_nombre", "tipo": "tutor_nombre_completo", "xPct": 22.51, "yPct": 13.99, "pagina": 4, "anchoPct": 38.3, "tamPct": 1.8},
      {"id": "tutor_dni", "tipo": "tutor_dni", "xPct": 70.38, "yPct": 13.99, "pagina": 4, "anchoPct": 14.78, "tamPct": 1.8},
      {"id": "tutor_domicilio", "tipo": "tutor_domicilio", "xPct": 49.55, "yPct": 16.21, "pagina": 4, "anchoPct": 35.95, "tamPct": 1.8},
      {"id": "tutor_movil", "tipo": "tutor_movil", "xPct": 14.78, "yPct": 20.6, "pagina": 4, "anchoPct": 50.06, "tamPct": 1.8},
      {"id": "menor_nombre", "tipo": "menor_nombre_completo", "xPct": 35.44, "yPct": 27.77, "pagina": 4, "anchoPct": 44.35, "tamPct": 1.8},
      {"id": "menor_nacimiento", "tipo": "menor_fecha_nacimiento", "xPct": 48.04, "yPct": 30.15, "pagina": 4, "anchoPct": 37.29, "tamPct": 1.8},
      {"id": "menor_edad", "tipo": "menor_edad", "xPct": 20.83, "yPct": 32.52, "pagina": 4, "anchoPct": 10.08, "tamPct": 1.8},
      {"id": "entidad", "tipo": "entidad", "xPct": 14.78, "yPct": 40.6, "pagina": 4, "anchoPct": 69.88, "tamPct": 1.8},
      {"id": "marca_carroza", "tipo": "marca_x", "xPct": 56.86, "yPct": 44.48, "pagina": 4, "tamPct": 1.8},
      {"id": "acomp_nombre", "tipo": "acomp_nombre_completo", "xPct": 31.24, "yPct": 60.55, "pagina": 4, "anchoPct": 50.9, "tamPct": 1.8},
      {"id": "acomp_parentesco", "tipo": "acomp_parentesco", "xPct": 24.36, "yPct": 62.93, "pagina": 4, "anchoPct": 24.53, "tamPct": 1.8},
      {"id": "acomp_movil", "tipo": "acomp_movil", "xPct": 62.83, "yPct": 62.93, "pagina": 4, "anchoPct": 20.49, "tamPct": 1.8},
      {"id": "fdo_nombre", "tipo": "tutor_nombre_completo", "xPct": 34.6, "yPct": 82.53, "pagina": 4, "anchoPct": 33.09, "tamPct": 1.8},
      {"id": "fdo_dni", "tipo": "tutor_dni", "xPct": 41.49, "yPct": 84.9, "pagina": 4, "anchoPct": 21.17, "tamPct": 1.8},
      {"id": "firma", "tipo": "firma", "xPct": 69.21, "yPct": 79.35, "pagina": 4, "tamPct": 1.8}
    ]
  },
  {
    id: 'cabalgata-2027-cordon',
    titulo: 'Declaración del cordón de seguridad (Cabalgata 2027)',
    archivo: 'assets/documentos/cabalgata-2027-cordon-seguridad.pdf',
    aplica_a: 'adulto',          // cada adulto que va (socio o no socio)
    pagina: 1,                   // los datos van en la 1 y la firma en la 2
    campos: [
      {"id": "entidad", "tipo": "entidad", "xPct": 36.12, "yPct": 12.8, "pagina": 1, "anchoPct": 55.1, "tamPct": 1.8},
      {"id": "marca_carroza", "tipo": "marca_x", "xPct": 51.91, "yPct": 16.75, "pagina": 1, "tamPct": 1.8},
      {"id": "nombre", "tipo": "nombre_completo", "xPct": 8.4, "yPct": 21.23, "pagina": 1, "anchoPct": 66.18, "tamPct": 1.8},
      {"id": "dni", "tipo": "dni_nie", "xPct": 8.06, "yPct": 23.49, "pagina": 1, "anchoPct": 12.77, "tamPct": 1.8},
      {"id": "lugar", "tipo": "lugar", "xPct": 10.75, "yPct": 72.19, "pagina": 2, "anchoPct": 25.2, "tamPct": 1.8},
      {"id": "dia", "tipo": "dia_hoy", "xPct": 38.64, "yPct": 72.19, "pagina": 2, "tamPct": 1.8},
      {"id": "mes", "tipo": "mes_hoy", "xPct": 44.68, "yPct": 72.19, "pagina": 2, "anchoPct": 13.44, "tamPct": 1.8},
      {"id": "firma", "tipo": "firma", "xPct": 8.4, "yPct": 80.77, "pagina": 2, "tamPct": 1.8}
    ]
  }
];
