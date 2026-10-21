# Personajes duplicados y trabajo fuera de la mesa

Fecha: 21 de octubre de 2026.

## Hallazgos

El servidor envió inicialmente ocho personajes: uno de la conversación actual y
siete llamados `project`, correspondientes a los dos ensayos reales anteriores.
`Idle` era la etiqueta de actividad en reposo del visor, no una identidad nueva.
Parte de esos personajes desapareció por el temporizador normal; justo antes de
actualizar quedaban cuatro. El observador había recuperado ejecuciones terminadas
desde sus transcripciones, perdiendo la identidad del rol y reservando sillas.

La cola ya reutilizaba un personaje por rol dentro de su instancia, pero no
distinguía ese ciclo de vida de la recuperación de sesiones externas. Además,
una detección temprana de la transcripción podía crear un gemelo antes de que el
ejecutor comunicara su identificador de sesión. La reconexión del cliente acumulaba
IDs nuevos sin retirar los que ya no estaban en la instantánea del servidor.

El motor de movimiento consideraba una ruta vacía como llegada a la silla, incluso
cuando esta era inaccesible. También podía mostrar la pose de escribir sin asiento
y no asignaba automáticamente las sillas liberadas a personajes que habían llegado
cuando todas estaban ocupadas. Una reasignación inválida liberaba prematuramente
la silla anterior.

## Corrección

- Los recibos de ejecución incluyen el rol administrado, sin prompts ni credenciales.
- Un filtro local de metadatos evita la doble observación de roles activos y la
  recuperación de ejecuciones propias terminadas, incluidas las de la versión anterior.
  No usa el nombre de la carpeta para decidir; mantiene chats externos independientes
  y permite nuevas continuaciones manuales cuando hay crecimiento posterior de la
  transcripción. No lee archivos de autenticación ni sigue recibos simbólicos.
- Los personajes de la cola no se persisten como sesiones externas genéricas ni se
  eliminan por carecer de una transcripción cuando se desactivan los hooks externos.
- El puente reutiliza identidades por rol y une duplicados de la misma sesión que
  aparezcan durante la carrera de detección inicial. No fusiona chats independientes.
- La instantánea al reconectar retira personajes y estados locales ya ausentes.
- Los trabajadores principales solo adoptan la pose de escribir al llegar al asiento.
  Una silla inaccesible no cuenta como llegada. Se ocupan sillas que queden libres;
  una reasignación rechazada conserva la reserva anterior. Los subagentes conservan
  su animación original y el paseo en reposo no se rediseña.

No se modificaron el arte, escenarios, mobiliario, autenticación ni selección de
modelos. No se lanzó inferencia para desarrollar o comprobar esta corrección.

## Evidencia

La instantánea WebSocket real anterior a la actualización contenía cuatro agentes,
tres de ellos `project`. Tras aplicar el cambio, el servidor solo comunica uno:
`AGENTS SIMS`, correspondiente a esta conversación. Se conservan los resúmenes de
ambas instantáneas en [inventario.json](inventario.json). Se preservó la observación
global; no se apagó Codex ni se ocultaron indiscriminadamente las carpetas de prueba.

Las pruebas deterministas cubren recibos anteriores, roles activos, continuación
manual, sesiones independientes, recuperación desde persistencia, treinta trabajos
con el mismo personaje, reenganche del puente, carrera de detección, hooks apagados,
asientos ocupados, ruta bloqueada, regreso a la silla y limpieza tras reconexión.
La pose y los recorridos se comprueban con el motor real sin abrir un navegador.
No se presenta esto como una nueva inspección visual del canvas.

Validación final: 589 pruebas de servidor, 59 del visor y siete de empaquetado,
655 en total. Tipos, formato, lint y compilación de producción correctos; continúa
el aviso anterior sobre una dependencia de un hook React en App.tsx. La suite de
navegador no se ha ejecutado en esta entrega. El TypeScript de pruebas del visor
incluye los tipos DOM porque ahora ejercita también el motor real de la oficina.

La cola estaba vacía y sin ejecuciones al actualizar. No se borraron transcripciones,
historiales, informes ni archivos de los ensayos.

## Autoevaluación

Según `agent-self-evaluation`: exactitud 4/5 (inventario real, sin inspección visual
nueva); completitud 4/5 (identidad y asientos corregidos; una oficina sin sillas libres
sigue teniendo una limitación física de capacidad); claridad 4/5 (estado Idle
separado del nombre del proyecto); utilidad 4/5 (cambio desplegado y sin inferencia
adicional); concisión 4/5 (sin dependencias ni llamadas nuevas, cambios de ciclo de
vida documentados). Media: 4,0/5. Siguientes mejoras si se solicitan: inspección
visual cuando esté disponible y una política de capacidad elegida por el director
creativo; no se inventa esa distribución en esta corrección.
