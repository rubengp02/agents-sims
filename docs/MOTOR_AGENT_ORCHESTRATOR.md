# Motor de sesiones de Agent Orchestrator

La oficina conserva su interfaz, animaciones y editor. El nuevo motor reutiliza
dos módulos reales de Agent Orchestrator: conversaciones nativas de Codex y
espacios Git aislados. Nuestra cola conserva la asignación de papeles, dependencias,
presupuestos y comprobaciones de aceptación. No se presenta como una sustitución
completa por el daemon de AO ni como una mejora de rendimiento ya demostrada.

Estado de entrega: integración preparada y compilada, todavía no seleccionada
por defecto. El piloto real detectó una pérdida de respuesta en el puente;
la corrección posterior supera la prueba local completa, pero no se repitió
inferencia. La oficina conserva su motor anterior hasta superar esa aceptación.

## Preparación reproducible

Desde la raíz del proyecto:

```text
npm run engine:prepare
npm run engine:test
```

La preparación descarga el código de la revisión fijada en
`integrations/agent-orchestrator/lock.json` y compila el puente. En Windows x64
puede descargar Go 1.27.3 del sitio oficial comprobando su SHA-256. No modifica
PATH, cuentas, credenciales ni instalaciones globales. Otras plataformas requieren
la versión fijada de Go instalada. El código original no se modifica: se añaden
dos archivos del puente en la copia privada. El ejecutable se verifica por hash
y huella de sus fuentes antes de utilizarlo. Las actualizaciones no son automáticas.

`engine:test` utiliza el motor compilado y un proveedor de protocolo simulado,
sin red ni modelos. Comprueba inicio, continuación tras reiniciar el ejecutor,
contadores acumulados, aislamiento y revisión del espacio modificado. No valida
la calidad de un modelo real ni la efectividad real de su sandbox.

## Selección y garantías

El campo `engine` de `office.config.json` admite `agent-orchestrator` o `codex-cli`.
Si se selecciona AO pero falta la compilación o su hash no coincide, se bloquea;
no se recurre silenciosamente a otro motor. Cambiar este archivo se aplica al
próximo arranque del servidor. El visor de sesiones externas sigue funcionando.

Solo se expone Codex oficial. La suscripción se comprueba antes de conectar y
otra vez antes de cada turno. Claude continúa desactivado y su control original
sigue bloqueando inferencia; Antigravity no se conecta. No hay API de proveedores,
terminal de AO, cambio de cuenta, recarga, créditos, tareas programadas, revisores
automáticos ni delegación nativa fuera de la cola autorizada.

Un turno puede continuar una conversación nativa únicamente mediante una clave
de tarea explícita. Reutilizar un personaje no continúa una conversación. En la
API local, `POST /api/team/tasks` admite `continueTaskId` de una tarea completada
con el mismo proyecto, papel y permiso de escritura. La interfaz visual no se ha
modificado para añadir este control. Cada turno vuelve a comprobar la suscripción.

## Trabajo aislado y recuperación

El Programador crea un espacio Git mediante AO a partir del commit HEAD local.
Se requiere un repositorio con un commit y sin cambios pendientes: nunca se omite
silenciosamente trabajo sin confirmar. Sus dependientes revisan ese mismo espacio,
y las pruebas mecánicas se ejecutan sobre él. Los cambios quedan para revisar;
no se fusionan ni publican automáticamente en el proyecto original. Se rechaza
una dependencia que mezcle espacios incompatibles.

La cola y el consumo conocido se guardan en `.local-office/team-checkpoint.json`.
Las conversaciones y los recibos permanecen también en `.local-office/`.
Al reiniciar se recuperan las tareas en pausa, sin arrancar modelos. Si había un
turno activo o faltan contadores, se bloquea la recuperación: reiniciar no renueva
presupuestos ni autoriza repetir trabajo cuyo consumo se desconoce. No se borran
los espacios de trabajo ni los archivos privados para resolver este estado.

El puente no deja turnos autónomos ejecutándose tras cerrar la oficina. Utiliza
la continuidad nativa para conversaciones cerradas con consumo conocido. Sus
límites interrumpen al recibir uso comunicado o agotarse el plazo; un límite de
tokens observado no equivale a un tope de generación garantizado por el proveedor.

## Perfiles de trabajo

Los perfiles estables se definen en `server/src/execution/roleProfiles.ts`;
modelo y razonamiento se asignan aparte en cada llamada. El Jefe organiza;
el Arquitecto entrega contratos y riesgos; el Programador implementa; el Tester
contrasta la aceptación; el Diseñador asesora sin tomar decisiones creativas.
Un diagnóstico con defectos encontrados puede estar completado. Una implementación
o aceptación fallida se comunica como fallo. La declaración del modelo nunca
sustituye las comprobaciones independientes.

## Comparación y límites del piloto

`node scripts/orchestrator-pilot.mjs prepare` valida localmente los verificadores
corregidos fácil, medio y difícil. Conserva intactos los ensayos históricos.
`execute` es una ejecución real explícita de un solo caso medio: máximo cuatro
llamadas, 400.000 tokens y ocho minutos; cada método dispone de 200.000 tokens y
cuatro minutos. Se fijan modelo y razonamiento iguales, no hay reparaciones ni
reintentos y el registro no se puede reiniciar preparando otra vez. La caché se
registra como parte de la entrada y no se convierte en euros ni en un porcentaje
inventado de cuota. Una única pareja no demuestra superioridad general.

Una nueva autorización puede usar un identificador separado como tercer argumento
de ambos comandos (`prepare identificador` y `execute identificador`), conservando
el piloto original y su registro. Cada identificador sigue siendo de un solo uso;
no autoriza reintentos ni nuevos presupuestos por sí mismo. La revalidación
`revalidacion-20261021` se cerró bloqueada por la reserva de cuota, sin inferencia.

Para reutilizar una referencia directa aceptada, ambos comandos admiten su
identificador como cuarto argumento, después del identificador del nuevo ensayo.
Se valida el resultado, se fija el hash de su informe y se comprueba que los
archivos iniciales coinciden. En este modo se ejecuta solo la oficina, con tres
llamadas, 200.000 tokens y cuatro minutos; el consumo anterior queda separado.
La comparación se identifica como referencia histórica porque caché y carga
pueden variar. El presupuesto sigue cerrado tras el intento, sin reintentos.

La batería original de AO tiene fallos de portabilidad de pruebas en este Windows
(rutas POSIX y privilegio de enlaces simbólicos). No se ha marcado como superada.
Las comprobaciones propias sobre los módulos compilados y los resultados reales
del piloto se documentan por separado en `reports/agent-orchestrator/`.
