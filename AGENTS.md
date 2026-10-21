# Guía de contribución — Pixel Office

## Producto y decisiones

- El usuario es el director creativo. Consulta antes de cambiar diseño, aspecto,
  personajes, animaciones o experiencia visual de forma importante. No rediseñes
  por iniciativa propia. Decide y ejecuta la implementación técnica con autonomía.
- Conserva las funcionalidades, el editor visual y la personalización existentes.
- Los personajes representan actividad real; distingue observación, ejecución y
  simulación. No presentes capacidades pendientes como implementadas.

## Suscripciones y proveedores

- La oficina sólo puede ejecutar mediante CLIs oficiales locales y cuotas incluidas
  en las suscripciones. No configures claves API, facturación por tokens, créditos
  adicionales ni recargas. No leas, copies ni manipules credenciales o tokens.
- Codex utiliza Codex CLI con sesión de ChatGPT. Antes de cada ejecución verifica
  el consumo incluido mediante el control existente. Si la verificación falla o
  se alcanza un límite, bloquea o pausa. Nunca uses un sistema de pago alternativo.
- Claude permanece opcional y desactivado inicialmente. Conserva su adaptador;
  habilitarlo no permite eludir sus comprobaciones oficiales ni su bloqueo actual
  de inferencia por falta de verificación del consumo adicional.
- Antigravity es únicamente una integración futura: no lo conectes ni intentes
  eludir restricciones. No incorpores OpenCode como motor sin un encargo específico.
- Mantén el modo automático predeterminado, el control manual de asignaciones,
  las dependencias, los límites y la selección sobre modelos realmente disponibles.
  Respeta las pausas: no eleves presupuestos ni reanudes tareas automáticamente.

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
- Informa qué se probó realmente, los resultados y las limitaciones. Una salida
  exitosa del CLI o un resultado simulado no sustituyen la aceptación de la tarea.
