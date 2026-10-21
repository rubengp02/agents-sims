# Contexto específico, especialistas y comprobaciones locales

La oficina conserva el panel, los personajes, el editor y las animaciones. Las
opciones manuales y el planificador existente siguen disponibles.

Las tareas del servidor admiten `context` con `objective`, `files`, `decisions`,
`acceptance` y `checks`. Los archivos son referencias relativas al proyecto; no se
copian automáticamente. El contexto se valida y rechaza si pierde la aceptación o
supera sus límites. Los resultados dependientes tienen límites de 4.000 caracteres
por resultado y 8.000 en conjunto, contando su representación JSON, y una marca
explícita de recorte. El agente debe recuperar detalles cuando sean necesarios.
Un hash identifica el contenido preparado; no demuestra caché ni verifica por sí
solo que los archivos no hayan cambiado.

La clasificación local admite evidencias `assessment`: alcance (`explanation`,
`bounded`, `cross-module`), riesgo e incertidumbre (`low`, `high`, `unknown`),
módulos, pruebas (`available`, `missing`, `unknown`) y decisión visual opcional.
Las evidencias son datos del llamador, no una inspección automática del repositorio.
Las palabras de la petición sirven de respaldo conservador; una petición de
documentación sobre seguridad no equivale a modificar la autenticación.

`TeamCoordinator.addScopedWorkflow` y el endpoint local protegido
`POST /api/team/scope` preparan tareas sin consultar al Jefe. El cuerpo contiene
`project`, `context`, `assessment` y `allowWrites` opcional. Se aplican el origen
local y el nonce `x-office-control` existentes. Preparar tareas no las ejecuta:
se conservan asignación, aprobación, modo manual/mixto y límites normales.
Es una entrada del servidor, sin añadir controles al diseño del panel.

- Una explicación directa utiliza un papel y exige solo lectura.
- Un cambio acotado solo puede prescindir del Tester con un módulo conocido,
  riesgo e incertidumbre bajos, pruebas disponibles y aceptación local configurada.
- Riesgo alto, trabajo entre módulos o incertidumbre alta mantienen análisis y
  revisión independiente. La falta de evidencias conserva al Tester.
- El Diseñador solo aparece con una decisión visual explícita. Las decisiones
  creativas siguen requiriendo revisión humana.

Los comandos se configuran desde código local en `LocalChecks`, nunca desde un
prompt, respuesta IA o comando enviado por HTTP. `pixelOfficeChecks` registra los
scripts existentes del proyecto al arrancar con npm: `check-types`, `lint`, `test`,
`package` y los tests del estudio. Solo `test` está marcado como aceptación; lint
o tipos por sí solos no permiten quitar QA. El registro solo puede ejecutarse en
su proyecto. Sin un registro adecuado, se bloquea la reducción de revisión.
Otros proyectos requieren su propio registro local y pruebas adecuadas al contrato.

Una tarea con comprobaciones permanece activa hasta terminar estas. Un fallo
bloquea sus dependencias; pausa y cancelación detienen los procesos locales.
Las salidas completas quedan en `.local-office/check-logs/`, ignorado por Git.
El estado compartido conserva identificador de check, duración, código y resultado.
Esto verifica comandos concretos, no constituye un verificador universal de calidad.

Comandos del estudio, desde Pixel Office:

```powershell
npm run study:optimization
npm run verify:local
npm run study:pilot
```

El primero evalúa contextos y clasificación sin inferencia. El segundo ejecuta
secuencialmente las comprobaciones configuradas y registra todos los intentos,
sin pedir a un modelo que arranque cada comando. El tercero solo muestra los
límites; no llama al modelo sin la opción explícita de ejecución.

El piloto autorizado del 21 de octubre ya agotó sus dos intentos. Su registro
persistente impide volver a ejecutarlo o reiniciar el presupuesto, incluso tras
un cierre inesperado. No lo borres para repetir. Una ampliación requiere un nuevo
encargo y presupuesto explícitos. Los límites fueron 2 intentos, 4 minutos totales,
90 segundos por ejecución y 60.000 tokens comunicados, reservando 30.000 para cada
intento. El corte por tokens actúa cuando el CLI comunica consumo; no limita con
exactitud la generación del proveedor. Las comprobaciones de suscripción, catálogo,
cuota y ausencia de créditos se repiten en cada ejecución oficial.

Los recibos nuevos guardan caché de entrada cuando el CLI la comunica, versión del
CLI y fecha de verificación. Ausente o inválida permanece desconocida, nunca cero
inventado. Los recibos anteriores siguen siendo compatibles. `sessionMode=new`
significa una sesión CLI nueva: reutilizar un personaje o ver caché no equivale a
continuar una sesión. No se ha implementado `resume` ni una conversación universal.

Consulta las mediciones y limitaciones en
[OPTIMIZACION.md](../reports/contexto/OPTIMIZACION.md).
