# La conversación como recorrido principal

Entrega local del 22 de octubre de 2026.

Actualización posterior de presupuesto: el chat normal ya no exige cotas ni
estimaciones acreditadas para arrancar. La revisión descrita en esta entrega inicial
se conserva solo en el modo manual opcional y en la cola avanzada. Véase la política
vigente en [Conversaciones](CONVERSACIONES.md#presupuesto-normal-y-manual).

La oficina standalone con historial configurado abre directamente el chat.
El recorrido es seleccionar proyecto, escribir, revisar un resumen de permisos y
cuota, ejecutar y recibir el resultado en la misma conversación. La cola queda
disponible como vista avanzada en **Ver cola**, y el espacio visual con su editor
se conserva en **Ver oficina**. La [guía de uso](CONVERSACIONES.md) está actualizada.

## Comportamiento

- El proyecto seleccionado reúne sus conversaciones e instrucciones. Al registrar
  un proyecto se abre una conversación; no hace falta crear una tarea por separado.
- **Enviar** guarda y prepara el mensaje, comprueba la disponibilidad sin inferencia
  y muestra el proyecto, archivos autorizados, proveedor y modelo.
- **Confirmar y ejecutar** autoriza conjuntamente cuota y, cuando se solicitaron,
  cambios en archivos. La ejecución se limita a ese mensaje. No arranca otros
  encargos pendientes ni flujos de otras conversaciones.
- El resumen tiene una huella ligada al encargo, permisos, modelo, configuración
  del proyecto y límites. Si cambia, se pide una confirmación nueva.
- Los estados, las respuestas, las pausas y la detención del encargo se presentan
  en el chat. La revisión de una cota, cuando no existe evidencia suficiente, sigue
  disponible junto a la confirmación y no se rellena con cifras inventadas.
- En móvil, la navegación de proyecto e historial es desplegable. Se mantienen
  etiquetas de formularios, navegación por teclado, foco dentro del diálogo,
  Escape para volver a la oficina y un registro accesible de mensajes.

## TURBO

TURBO requiere una activación explícita en los ajustes de un proyecto. Guarda un
permiso de cambios de archivos para ese proyecto, hasta desactivarlo, también tras
reiniciar. Los otros proyectos conservan sus propios permisos.

En este modo no se vuelve a solicitar el permiso de escritura en cada mensaje,
pero permanece **Usar cuota y ejecutar**. Se mantienen la comprobación oficial de
suscripción y cuota, el sandbox, la revisión de presupuesto, los límites y las
pausas. No se habilitan pagos, claves API, proveedores alternativos ni nuevos
pilotos reales. Cancelar, pausar, cambiar una asignación o revocar TURBO invalida
las autorizaciones de ejecución pendientes correspondientes. Los reinicios no
restauran confirmaciones de ejecución.

## Validación

El archivo `server/__tests__/conversationLibrary.test.ts` conserva las nueve pruebas
de historial y añade nueve de este recorrido:

1. Preparación sin inferencia y ejecución exclusiva del mensaje confirmado.
2. Rechazo de mensajes sin confirmar desde la cola y de escrituras sin autorización.
3. TURBO persistente por proyecto, sin autorizar por sí solo el consumo de cuota.
4. Bloqueo por falta de cuota incluso con TURBO y rechazo de su activación por un
   campo ajeno a la ruta dedicada de permisos.
5. Revocación de TURBO con un mensaje ya preparado.
6. Confirmación nueva tras reiniciar, aunque TURBO siga activo.
7. Revisión de presupuesto obligatoria con historial insuficiente, sin elevar límites.
8. Protección de las rutas nuevas mediante el control local existente.
9. Rechazo de un resumen de confirmación que ya no corresponde a la configuración.

La prueba de navegador de conversaciones usa Edge, un servidor real en un proceso
hijo y un almacén temporal. Recorre registro de proyecto, aprobación de pruebas,
envío, confirmación agrupada, ejecución y respuesta; guarda un borrador, reinicia
el proceso y continúa la conversación. Activa TURBO mediante su confirmación,
ejecuta otro mensaje y comprueba el acceso secundario a la cola, el foco de teclado
y la adaptación a móvil. Las pruebas de equipo y flujos avanzados también se
conservan; la espera de la aceptación de integración admite el tiempo de las
operaciones Git y pruebas reales, sin ampliar el presupuesto del runtime.

El proveedor de IA y la evidencia de suscripción son simulados. Los procesos,
HTTP, archivos, comprobaciones locales y navegador sí se ejecutan. No se ha probado
inferencia real ni se atribuye consumo de modelos a los contadores simulados.

Resultados aprobados:

- `npm test`: 717 pruebas del servidor, 59 de interfaz y 7 del contrato del paquete.
- `npm run package`: tipos, lint y empaquetado aprobados. Lint conserva una
  advertencia previa de `App.tsx` sobre la dependencia `editor` de un efecto.
- Navegador: tres recorridos aprobados (chat, equipo y flujos). El chat se repitió
  después de ajustar el móvil y comprobar que el permiso normal de escritura no
  queda seleccionado para el siguiente mensaje; esa comprobación también pasó.
- Estudio de contexto: cuatro pruebas aprobadas.

Esta evidencia no sustituye una aceptación humana ni una evaluación real de modelos.

## Límites conocidos

- Añadir un proyecto permite elegir la carpeta con el diálogo nativo de Windows
  o pegar la ruta. La primera inspección no detectó las ventanas, pero el usuario
  confirmó que sí se abrían. Se ha retirado el explorador integrado provisional.
- La falta de evidencia de presupuesto sigue necesitando revisión humana. TURBO
  no la convierte en una autorización automática ni garantiza que una tarea real
  se resuelva correctamente.
- Los borradores siguen usando **Guardar borrador**. El historial conserva las
  garantías y límites locales documentados, incluido su límite de 64 MiB.
- La planificación de varios pasos, las asignaciones manuales y los flujos
  experimentales siguen en la cola avanzada. Este recorrido prepara un encargo
  individual; no reemplaza esos controles ni declara aceptado un cambio de producto
  por el mero hecho de recibir una respuesta.

## Revisión final

Autoevaluación de calidad: 4,0/5; no es una aprobación humana.

| Eje           | Nota | Evidencia y margen de mejora                                                                                                              |
| ------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Exactitud     | 4/5  | Controles y recorridos comprobados; la inferencia real queda expresamente fuera de esta validación.                                       |
| Cobertura     | 4/5  | Envío, confirmación, TURBO, reinicio y aislamiento de encargos cubiertos; la planificación avanzada sigue en la cola.                     |
| Claridad      | 4/5  | Resumen único de permisos y cuota, chat principal y navegación móvil desplegable; falta la valoración de comodidad del usuario.           |
| Uso inmediato | 4/5  | Paquete local compilado, guía actualizada y recorrido probado; la revisión manual de cotas sigue siendo necesaria cuando falte evidencia. |
| Concisión     | 4/5  | El recorrido normal evita controles de procesos; las opciones heredadas se mantienen agrupadas en la vista avanzada.                      |

No se identificaron ejes críticos. La siguiente mejora de mayor impacto sería
evaluar con usuarios la comprensión del resumen y de las cotas, conservando las
comprobaciones existentes. La decisión de diseño y la aceptación final corresponden
al usuario, no a esta autoevaluación.
