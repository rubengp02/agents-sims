# Guía de contribución — Pixel Office

## Producto y decisiones

- El usuario es el director creativo. Consulta antes de cambiar diseño, aspecto,
  personajes, animaciones o experiencia visual de forma importante. No rediseñes
  por iniciativa propia. Decide y ejecuta la implementación técnica con autonomía.
- Conserva las funcionalidades, el editor visual y la personalización existentes.
- Conversaciones usa la tipografía del sistema (`system-ui`) para facilitar la
  lectura, con mensajes de 16 px. Conserva la fuente pixelada en el resto de la oficina.
- El usuario ha autorizado autonomía permanente en el proyecto: en el chat normal,
  Enviar autoriza escritura, herramientas locales, pruebas y cuota incluida sin
  confirmaciones adicionales. Conserva la preferencia por proyecto y la opción
  manual. No reintroduzcas confirmaciones habituales. Mantén comprobación de cuota,
  cancelación y revisión de pausas reales; abrir el historial nunca ejecuta trabajo.
- Los personajes representan actividad real; distingue observación, ejecución y
  simulación. No presentes capacidades pendientes como implementadas.
- El Jefe ajusta el equipo a la petición: descripciones, traducciones y resúmenes
  breves se resuelven directamente, con las lecturas mínimas y sin Tester por
  rutina. Reutiliza contexto vigente y agrupa lecturas. Un permiso de escritura
  no implica que haya que editar. Cambios de código, investigación completa,
  riesgos relevantes y trabajo delegado conservan revisión independiente.
  Añadir un especialista exige identificar la incertidumbre que resolverá.
- Los seguimientos de presentación («incluye los siguientes pasos», «resúmelo»,
  «reformúlalo en cinco puntos») reutilizan la respuesta y las fuentes anteriores.
  No repitas su verificación por rutina. Una indicación de formato no cancela
  requisitos de implementación ni revisiones pendientes de cambios reales.
- Publicar, enviar mensajes o modificar servicios externos requiere aprobación
  humana de la operación concreta. La autonomía local no concede permisos externos.
- Las asignaciones del Jefe mediante el contrato de la oficina están autorizadas.
  Distingue esa coordinación de lanzar CLIs de IA o subagentes por cuenta propia;
  no introduzcas una prohibición general de delegar en los prompts del Jefe.

## Suscripciones y proveedores

- La oficina sólo puede ejecutar mediante CLIs oficiales locales y cuotas incluidas
  en las suscripciones. No configures claves API, facturación por tokens, créditos
  adicionales ni recargas. No leas, copies ni manipules credenciales o tokens.
- Codex utiliza Codex CLI con sesión de ChatGPT. Antes de cada ejecución verifica
  el consumo incluido mediante el control existente. Si la verificación falla o
  se alcanza un límite, bloquea o pausa. Nunca uses un sistema de pago alternativo.
- Un recibo sin contadores se conserva como desconocido y pausa ese intento. Un
  envío o reintento explícito del chat normal puede continuar tras verificar cuota
  actual, sin borrar el recibo ni reiniciar contadores. La cola y el presupuesto
  manual siguen necesitando totales históricos verificables.
- El usuario autoriza una continuación automática cuando el proveedor confirme
  saturación del modelo: como máximo una por encargo, al siguiente modelo inferior
  disponible y adecuado, con el mismo razonamiento, proveedor oficial y cuota incluida
  nuevamente comprobada. Conserva el recibo anterior, incluso desconocido. Solo
  continúa si ese intento no inició herramientas, aprobaciones ni salida del modelo;
  ante efectos inciertos conserva el trabajo y pausa. Un 429 genérico no confirma
  saturación. Los presupuestos manuales y los benchmarks con modelo fijado no
  cambian de modelo automáticamente. Reiniciar o abrir el historial no reanuda nada.
- Claude permanece opcional y desactivado inicialmente. Conserva su adaptador;
  habilitarlo no permite eludir sus comprobaciones oficiales ni su bloqueo actual
  de inferencia por falta de verificación del consumo adicional.
- Antigravity utiliza su CLI oficial con cuota incluida y créditos adicionales desactivados,
  verificados antes de cada intento y en su carpeta privada. Conserva su guardián MCP,
  los permisos por empleado y las aprobaciones externas. Solo las versiones acreditadas
  pueden ejecutar. Un catálogo por sí solo no acredita esos permisos.
  No inventes evidencia ni eludas restricciones. No incorpores OpenCode sin un encargo específico.
- Mantén el modo automático predeterminado, el control manual de asignaciones,
  las dependencias, los límites y la selección sobre modelos realmente disponibles.
  Respeta las pausas: no eleves presupuestos ni reanudes tareas automáticamente.
- Un Programador por encargo es la política predeterminada. Conserva ayudantes y
  revisión independiente cuando sean necesarios. Dos escritores aislados son
  experimentales: requieren `experimentalParallelWriters: true` explícito, AO y
  todos los controles existentes. Ni el Jefe ni una estimación favorable los
  activan automáticamente. No hagas nuevos pilotos reales sin autorización.

## Mapa y contexto

- `core/`: contratos y tipos compartidos; `server/`: servidor y runtime;
  `server/src/execution/`: ejecutores y coordinación;
  `webview-ui/`: React, oficina Canvas y editor;
  `adapters/vscode/`: integración con VS Code.
- Usa TypeScript y las convenciones existentes. Conserva contratos y animaciones.
- Lee sólo la documentación pertinente: `docs/EJECUCION_OFICIAL.md` para ejecución,
  `docs/EQUIPO_MULTIAGENTE.md` para coordinación y límites,
  `docs/INSTALACION_LOCAL.md` para arranque. Los informes son evidencia histórica,
  no una garantía de funcionamiento de todas las capacidades futuras.
- No añadas instrucciones de otros proyectos al contexto. No pegues historiales
  completos cuando basten el objetivo, los archivos relevantes y un resultado breve.
- `.local-office/` contiene estado privado ignorado por Git. No publiques logs,
  transcripciones, rutas personales ni credenciales. Conserva licencias y avisos.

## Trabajo y validación

- Las preferencias globales permiten commits y ramas locales de trabajo; no
  incluyas cambios ajenos. Publicar o desplegar debe formar parte del encargo.
- Comandos desde esta carpeta: `npm run check-types`, `npm run lint`,
  `npm test` y `npm run package`. El estudio local de contexto se comprueba con
  `node --test scripts/context-study.test.mjs`.
- Ejecuta las comprobaciones pertinentes al cambio. Las pruebas habituales usan
  simulaciones y hogares temporales: no gastan cuota de modelos ni alteran datos
  de usuario. Las pruebas con IA real deben estar autorizadas, tener límites y
  pasar el control de suscripción; nunca las ejecutes implícitamente en CI.
- Respeta cualquier bloqueo de herramientas o de acceso al navegador; no lo eludas.
- La captura de revisiones y la copia de trabajo no tienen topes artificiales de
  megabytes, número de archivos o profundidad. Procesa contenido por bloques y
  guarda evidencia completa fuera del proyecto; los diffs grandes se consultan
  desde un artefacto completo. Excluye dependencias, cachés y `.vscode-test`.
- Informa qué se probó realmente, los resultados y las limitaciones. Una salida
  exitosa del CLI o un resultado simulado no sustituyen la aceptación de la tarea.
