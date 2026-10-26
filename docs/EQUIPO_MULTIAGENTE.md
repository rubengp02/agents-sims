# Equipo multiagente local

La política vigente utiliza **un Programador por encargo**. Los ayudantes de
lectura y las revisiones necesarias se conservan. Dos Programadores aislados
son experimentales y requieren activar expresamente `experimentalParallelWriters`;
seleccionar AO o permitir dos actividades simultáneas no basta. La prioridad
actual es reducir contexto y mejorar estimaciones con un Programador. Los pilotos
reales de paralelismo quedan pausados hasta una autorización nueva. Detalles en
[OFICINA_PARALELA.md](OFICINA_PARALELA.md).

## Cómo utilizarlo

El recorrido principal es **Conversaciones**: seleccionar proyecto, escribir,
enviar para iniciar con permisos permanentes del proyecto, y recibir el resultado en el mismo chat. La cola es
una vista avanzada accesible con **Ver cola**; confirmar un mensaje no ejecuta
otros encargos pendientes. Consulta [CONVERSACIONES.md](CONVERSACIONES.md).

El chat normal usa la gestión de contexto de Codex y la cuota de suscripción sin
pedir cotas técnicas. Los límites numéricos descritos para la cola avanzada se
mantienen en esa cola y al seleccionar expresamente presupuesto manual en el chat.
El modo normal no corta por duración; conserva permisos, cancelación, comprobación
de cuota y revisión de las pausas. La [oficina iterativa](OFICINA_ITERATIVA.md)
permite al Jefe asignar sucesivos encargos dentro del mismo objetivo confirmado.

Para utilizar los controles avanzados:

1. Abre la oficina con el lanzador habitual y entra en **Ver cola**.
2. Deja **Automático**, que es el modo inicial. **Comprobar suscripciones y
   modelos** consulta los CLIs sin enviar una tarea a la IA.
3. Escribe la carpeta completa de tu proyecto y lo que quieres conseguir.
4. Para una petición sencilla, elige personaje y pulsa **Añadir tarea sin plan**.
   Para un trabajo con varios pasos, **Pedir plan al Jefe** consume una llamada
   y prepara entre una y cuatro tareas. Revisa el resultado.
5. Pulsa **Ejecutar cola**. Los resultados y los motivos de asignación aparecen
   en cada tarjeta. **Ver respuesta** muestra el resultado textual.

El plan del Jefe no se ejecuta automáticamente. En modo automático, **Ejecutar
cola** autoriza las asignaciones propuestas. En modo mixto, debes comprobar y
confirmar cada asignación. En modo manual, añade tareas directamente y selecciona
su proveedor, modelo y razonamiento antes de confirmarlas.

Los mensajes preparados desde el chat conservan además su confirmación de cuota
y archivos. **Ejecutar cola** no omite esa confirmación. TURBO solo recuerda el
permiso de archivos del proyecto; no elimina controles de ejecución ni presupuesto.

**Cambiar modelo** conserva el control manual en cualquier modo. El catálogo de
selección proviene de la última comprobación; se valida otra vez antes de ejecutar.
Una elección manual no puede eludir el control de suscripción.

## Controles avanzados del panel

Se utilizan las secciones desplegables y los componentes del panel existente;
no se cambia el diseño de la oficina, sus personajes ni las animaciones.

- **Organización del trabajo** muestra el motor y el aislamiento comunicados por
  el servidor. Permite activar o desactivar expresamente los dos Programadores
  experimentales cuando hay aislamiento disponible. Un Programador sigue siendo
  el valor inicial. Este control no selecciona otro motor ni inicia llamadas.
- **Encargo acotado y reparto de archivos** utiliza la carpeta, el objetivo y el
  permiso de cambios de arriba. Permite indicar archivos, decisiones, aceptación,
  comprobaciones, módulos, riesgo e incertidumbre. Riesgo y cobertura no se
  presuponen favorables. **Preparar encargo sin IA** crea las tareas mediante
  evaluación local y deja la ejecución pendiente de revisión y arranque.
- Con la opción experimental y AO disponible se pueden proponer dos partes:
  cada una tiene objetivo, archivos propios, aceptación y comprobaciones. Los
  archivos compartidos son de solo lectura. El contrato global debe contener
  todos esos elementos. El servidor rechaza un alcance incompatible y puede
  conservar la ejecución secuencial aunque el reparto parezca independiente.
- Las comprobaciones configuradas aparecen como casillas seleccionables tanto
  para el conjunto como para cada parte. Los IDs también pueden escribirse, pero
  siempre se validan localmente. El catálogo público contiene solo identificador
  y condición de aceptación; no expone ejecutables, argumentos ni logs.
- Cada tarjeta muestra trabajador, dependencias, carpeta de ejecución, archivos
  propios y resultados locales. **Estimación y reserva de la tarea** permite
  revisar cotas después de comprobar la asignación. No hay cifras favorables
  precargadas: la revisión manual debe basarse en evidencia y cabe en los límites
  globales ya existentes. Cambiar modelo o razonamiento invalida la vinculación
  anterior, que el servidor vuelve a comprobar.
- **Flujos e integración** muestra estado conjunto, razón de la organización,
  candidato, huella, pruebas y duraciones. Antes de arrancar permite revisar
  preparación, integración y alternativa secuencial, con todas las asignaciones
  comprobadas. Guardar cotas no consume una llamada ni arranca el equipo.

Los formularios de reservas se bloquean mientras hay actividad. Los flujos
recuperados en pausa conservan su evidencia y no ofrecen el botón genérico de
continuación como vía de reaceptación. Los límites muestran tiempo de pared,
suma de duraciones y consumo desconocido sin presentarlo como un total definitivo.

La selección del motor al arrancar y la definición de comandos del registro de
pruebas siguen siendo configuración local. El panel utiliza esas capacidades;
no añade cambio de motor en caliente, edición de comandos, publicación de parches
ni recuperación automática de candidatos. Ninguno de estos controles autoriza
nuevos pilotos reales por sí mismo. Su verificación inicial utiliza proveedores
simulados, API local, worktrees Git y comprobaciones mecánicas reales.

Las tareas son de solo lectura inicialmente. La casilla de cambios permite
escritura en una tarea directa; en un plan solo se aplica al Programador. El Jefe
planifica sin editar. Las decisiones creativas siguen correspondiendo al usuario.

## Qué se ha conectado realmente

El flujo completo ha superado una prueba real pequeña el 21 de octubre de 2026:
Jefe → Arquitecto → Programador → Tester. Se crearon dos archivos, el Programador
y el Tester ejecutaron realmente once pruebas y una comprobación independiente
añadió 139 casos del contrato. El [reintento verificado](../reports/validacion-real/REINTENTO.md)
documenta los resultados y el arreglo de permisos del primer intento fallido.
Esto no valida todavía el paralelismo real ni proyectos de cualquier complejidad.

- La cola llama al ejecutor oficial Codex existente; no es una simulación visual.
- El Jefe planificador también utiliza ese ejecutor, y su respuesta debe superar
  una validación estructural antes de crear tareas.
- Programador, Tester, Arquitecto y Diseñador son papeles distintos con contexto
  acotado. Un rol reutiliza su personaje en tareas consecutivas.
- Los estados de ejecución crean/actualizan personajes mediante el almacén y el
  protocolo de animaciones existentes. No se cambian los gráficos de la oficina.
- Las tareas dependientes esperan una finalización correcta y reciben hasta
  4.000 caracteres por resultado, con un máximo conjunto de 8.000.
- No se realizan reuniones ni rondas de agentes por defecto.

## Personajes y mesas

`Idle` es la etiqueta de reposo del visor original, no el nombre de un agente.
`project` era el nombre de la carpeta de los ensayos locales. Las ejecuciones
terminadas de la oficina ya no se recuperan como nuevos personajes genéricos al
reiniciar ni se duplican entre el observador y la cola.

Cada rol reutiliza su personaje durante la sesión de la oficina. Las conversaciones
externas realmente distintas mantienen personajes independientes. Los registros
locales distinguen las ejecuciones administradas de la observación: no se ocultan
sesiones por llamarse `project`. Una continuación manual posterior del mismo chat
puede volver a observarse cuando su archivo muestra actividad nueva.

El personaje vuelve a una silla accesible antes de mostrar la pose de escribir.
Si no tiene asiento, puede tomar uno que quede libre. Una ruta bloqueada no se
interpreta como llegada a la mesa. En reposo se conserva el paseo original.
La reconciliación al reconectar elimina los personajes ausentes del servidor.
No se han cambiado escenarios, recursos gráficos ni distribución del mobiliario.

La comprobación y sus límites están en el
[informe de personajes](../reports/personajes/VERIFICACION.md).

Un turno del CLI terminado correctamente no demuestra que el encargo se haya
realizado. Los trabajadores deben cerrar su respuesta con una declaración de
resultado explícita (`OFFICE_RESULT`): completado, bloqueado o fallido. Un bloqueo,
fallo o declaración ausente detiene la cola e impide arrancar tareas dependientes.
El Jefe conserva su contrato JSON de planificación, validado por separado.
La declaración del agente no sustituye una comprobación independiente de archivos
y pruebas; aún no existe un verificador universal de aceptación para cada proyecto.

## Selección y ahorro

La clasificación de dificultad usa reglas conservadoras locales: no consume una
llamada adicional ni constituye una evaluación comparativa de la calidad de los
modelos. El catálogo automático está limitado a GPT-6 Luna y GPT-6.1 Sol, siempre
que el CLI anuncie la combinación necesaria. Los demás modelos requieren una
elección manual disponible. No se usa un modelo antiguo como alternativa oculta.

Se prioriza razonamiento bajo. Los indicios técnicos de mayor complejidad permiten
Sol con razonamiento alto. Cada tarjeta explica esa decisión. El modelo solicitado
y el confirmado son datos distintos: si el CLI no informa del segundo, se muestra
**no comunicado**.

Límites iniciales: 8 llamadas, 2 simultáneas como máximo, 15 minutos por tanda y
30.000 tokens comunicados. Codex permite dos ejecuciones independientes de solo
lectura. El Jefe debe declarar esa independencia; cuando no está clara, las tareas
se ejecutan por orden. Las escrituras son exclusivas y el mismo personaje no
realiza dos tareas a la vez.

Los planes del Jefe se validan como un grafo de dependencias. Arquitectura y diseño,
si están presentes, preceden al desarrollo; el QA espera a la implementación y al
análisis previo. El sistema añade esas dependencias aunque el modelo las omita y
reordena el plan cuando es posible. Los ciclos o instrucciones contradictorias
se rechazan antes de crear las tareas. Otras dependencias las propone el Jefe según
los resultados necesarios para cada trabajo.

Ejemplo: Arquitecto y Diseñador analizan en paralelo si el Jefe declara que son
independientes; Programador espera ambos resultados, trabaja solo y finalmente
el Tester comprueba la implementación. La tarjeta explica qué espera cada tarea.
Una tarea directa no se supone independiente automáticamente: conserva el orden
salvo declaración explícita de independencia en el contrato de tareas.

Dos lectores comparten plazas limitadas en el propio ejecutor, no solo en el panel.
Una tercera ejecución o un escritor incompatible queda bloqueado también desde
otro lanzador actualizado que use el mismo directorio de ejecución. Los bloqueos
abandonados requieren revisión; no se borran automáticamente. Las sesiones de
Codex que abras por tu cuenta fuera de la oficina no forman parte de esta cola.

El presupuesto de tokens se comprueba **entre llamadas** y utiliza el consumo de
entrada observado para evitar arrancar otra cuando parece insuficiente. No es un
tope exacto de generación: una respuesta puede superarlo. No equivale a euros ni
a la cuota porcentual real de una suscripción. Los límites de cuota se comprueban
por separado mediante el ejecutor oficial. Si el consumo queda desconocido, se
pausa el equipo. Las llamadas se cuentan conservadoramente como intentos
autorizados de ejecución, aunque el último control del ejecutor las bloquee.

Una prueba real mínima de esta integración comunicó 14.070 tokens entre entrada
y salida: gran parte corresponde al contexto base del CLI. Por eso conviene usar
tareas directas y pocos personajes, y no interpretar una petición corta como una
llamada sin contexto.

La prueba completa posterior de cuatro llamadas comunicó 126.572 tokens y necesitó
ampliar temporalmente el presupuesto para llegar al Tester; después se restauraron
los límites habituales. No equivale a 126.572 tokens nuevos sin caché ni a una
cantidad conocida de cuota porcentual. Los comandos de herramientas también
pueden aumentar el consumo comunicado dentro de una llamada del equipo.

En Windows se selecciona explícitamente el sandbox elevado ya preparado. Las
ejecuciones usan los perfiles oficiales `:read-only` y `:workspace` según el permiso
de escritura, sin mezclarlos con la configuración antigua `sandbox_mode`. Las
herramientas heredan solo el entorno esencial del CLI, ya filtrado, para encontrar
Node y otras herramientas locales. No se desactiva el sandbox ni se omiten reglas
administradas. El catálogo de skills tiene un presupuesto de contexto de 1.000
tokens; no es un tope del contexto completo ni una garantía de ahorro medido.

## Claude: preparado y bloqueado

Claude está desactivado inicialmente. El interruptor habilita su **comprobación**,
sin instalar herramientas ni iniciar sesión en tu nombre.

El adaptador consulta únicamente `claude auth status` mediante un ejecutable
nativo oficial local, con entorno limitado. No abre archivos de credenciales,
no copia tokens y no conecta directamente con endpoints de proveedores.

La autenticación personal y el plan no prueban que los créditos de uso adicionales
estén apagados. No se ha encontrado una superficie oficial documentada que lo
demuestre antes de inferencia. Por tanto, **las ejecuciones reales de Claude
permanecen bloqueadas**, incluso si el interruptor se activa y aparece una sesión
personal. Tampoco se supone que un campo no documentado sea prueba suficiente.

El constructor de argumentos Claude está preparado y probado sin inferencia; no
se ha ejecutado contra una suscripción real. La cola común para dos proveedores se
ha probado con adaptadores simulados. Esto no equivale a una prueba conjunta real
de Claude y Codex.

Referencias oficiales:

- [CLI y autenticación de Claude](https://code.claude.com/docs/en/cli-reference).
- [Prioridad de credenciales](https://code.claude.com/docs/en/authentication#authentication-precedence).
- [Créditos de uso adicionales](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans).

## Pausa, cierre y almacenamiento

**Pausar equipo** detiene sus procesos y deja las tareas en pausa. Para continuar,
espera a que terminen de detenerse, revisa el motivo, pulsa **Revisado: permitir
continuar**, confirma asignaciones si corresponde y vuelve a ejecutar. Se hace
una ejecución nueva: no se promete reanudación del mismo contexto del CLI.

Cerrar el panel o el navegador permite que el servidor siga trabajando. Cerrar la
oficina detiene los procesos administrados antes de finalizar el servidor.

Los límites y el modo se guardan en `.local-office/team-settings.json` del
directorio de arranque. La cola, sus resultados y contadores se recuperan desde
`.local-office/team-checkpoint.json`, sin reiniciar ejecuciones ni autorizaciones.
Las conversaciones completas, los proyectos, instrucciones y pruebas aprobadas
se guardan además en un archivo privado independiente, fuera de las carpetas de
código. Se pueden abrir desde **Conversaciones guardadas**, aunque el proyecto
ya no esté disponible. Detalles y límites en [CONVERSACIONES.md](CONVERSACIONES.md).
Los registros del ejecutor conservan metadatos, no copias de los mensajes.
El CLI oficial puede conservar su propio historial según su comportamiento.

Los endpoints de control exigen origen/host local y un nonce local para modificar
estado. No son una API pública para exponer en Internet.

No hay compra de créditos, cambio de cuenta, rutas API de inferencia ni recargas.
Antigravity es opcional: verifica cuota incluida y ausencia de créditos adicionales,
utiliza las herramientas mediadas de la oficina y conserva el contexto nativo del
Jefe por objetivo. Consulta [capacidades, comprobaciones y límites](ANTIGRAVITY.md).

## Reutilización de código abierto

Se ha adaptado el constructor de argumentos Claude de Claw-Empire y su patrón de
separación entre tareas, papeles y ejecución. La cola y el puente usan la base
actual de Pixel Office. No se han copiado lectores de credenciales, clientes HTTP
de inferencia, almacenamiento OAuth, recursos gráficos ni reuniones automáticas.

La procedencia, revisión exacta y licencia Apache-2.0 se conservan en
`THIRD_PARTY_NOTICES.md` y `licenses/Claw-Empire-Apache-2.0.txt`.
