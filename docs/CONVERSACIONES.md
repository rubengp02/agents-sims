# Conversaciones guardadas

La oficina guarda las conversaciones en este equipo. Cerrar el panel, el navegador
o la oficina no borra los mensajes enviados. No hace falta buscar archivos del CLI
para volver a leerlos.

Las imágenes, capturas y propuestas se conservan en el mismo historial. Consulta
[Herramientas de la oficina](HERRAMIENTAS_OFICINA.md) para adjuntarlas, comprobar
conexiones y conocer qué capacidades están verificadas.

## Uso

1. La oficina local se abre en **Conversaciones**. Selecciona un proyecto guardado
   o pulsa **Añadir proyecto** y **Elegir carpeta…** para abrir el selector nativo de Windows.
   Selecciona la carpeta en esa ventana, indica un nombre y guarda el proyecto.
   Se abrirá una conversación lista para escribir.
2. Escribe tu mensaje y pulsa **Enviar**. El trabajo comienza con permiso permanente
   de escritura, herramientas y pruebas locales del proyecto y cuota incluida.
   La respuesta aparecerá en la misma conversación; no necesitas abrir
   la cola ni introducir cotas de tokens, duración o caracteres en el modo normal.
3. Vuelve cuando quieras desde la lista de conversaciones de ese proyecto. Puedes
   buscar por título, leer las respuestas y descargar una copia. Abrir el historial
   no consulta ni ejecuta modelos. En móvil, **Proyecto e historial** permite mostrar
   u ocultar la navegación y deja más espacio para los mensajes.
4. Para seguir conversando, escribe el siguiente mensaje en esa conversación.
   Mientras trabaja, **Dejar pendiente** guarda el mensaje y sus imágenes para
   después de la entrega completa del Jefe. Puedes editarlo, retirarlo o pulsar
   **Aplicar ahora** para incorporar la indicación al objetivo actual.
   Las pausas por errores, cancelación, cuota o reinicio conservan los pendientes
   detenidos hasta una continuación explícita. Abrir el historial no ejecuta nada.

La pantalla ocupa toda la ventana: historial lateral plegable, mensajes centrados
y cuadro de escritura siempre disponible. **Enter** envía o deja pendiente;
**Mayús+Enter** introduce una línea nueva. Las asignaciones internas se consultan
en **Ver actividad de la oficina**. El menú superior reúne herramientas,
conexiones, cola, ajustes del proyecto y acceso a la oficina pixelada.

Los pendientes se procesan en orden, con una sola ejecución de oficina activa.
Los de otros chats esperan a que se libere la oficina. En modo manual se prepara
el encargo y sigue siendo necesaria su confirmación. Un envío incierto requiere
revisión y nunca se reintenta automáticamente.

La revisión y la copia de trabajo no imponen un tamaño máximo del proyecto ni un
número máximo de archivos. Las capturas se conservan en disco con huellas de
contenido y se leen por bloques. Los diffs grandes se guardan completos como
artefactos para su lectura por partes, sin cortar el encargo por ese tamaño.
Las dependencias, las cachés y la instalación de pruebas `.vscode-test` se excluyen
de la copia y de la comparación de código. Siguen siendo necesarios el espacio
real en disco, los permisos de lectura y una cuota disponible del proveedor.

**Aplicar ahora** usa el turno activo de Codex App Server. Cuando trabaja un
especialista, detiene esa actividad, conserva sus cambios y recibos y devuelve
el control al Jefe. Los requisitos nuevos requieren una revisión nueva del Tester.
Los motores sin esta capacidad mantienen disponible el envío pendiente.

**Guardar borrador** conserva un mensaje que todavía no has enviado. El texto que
solo has escrito, sin enviar ni guardar como borrador, no se guarda automáticamente.

El selector utiliza el diálogo moderno de Windows (`IFileDialog`, modo carpetas),
en el equipo que ejecuta la oficina local. Tiene una ventana propietaria para
mantener el diálogo visible y una única selección activa por servidor, incluso
con varias pestañas. Si queda detrás, puedes localizarlo con **Alt + Tab**. Cancelar
conserva la ruta anterior. También puedes pegar la ruta manualmente; esta opción
se mantiene en otros sistemas. Elegir una carpeta no ejecuta modelos ni guarda
todavía el proyecto. El tiempo de espera máximo es cinco minutos.

El selector se ejecuta mediante `dist/native/office-folder-picker.exe`, una aplicación
gráfica compilada junto con la oficina en Windows. El clic no inicia PowerShell
ni compila código: abre directamente el diálogo. El archivo se genera a partir de
`server/native/OfficeFolderPicker.cs` con el compilador de .NET Framework instalado
en Windows. Si falta, se informa del problema y se conserva la entrada manual.

Se descartó por error el primer selector al no aparecer en la herramienta de
inspección. El usuario confirmó que las ventanas sí aparecían; se ha recuperado
la selección nativa solicitada y retirado el explorador integrado provisional.

**Ver cola** mantiene disponibles las asignaciones, modelos y flujos avanzados.
**Ver oficina** abre el espacio visual y su editor. Puedes volver al chat mediante
el botón **Conversaciones**. Las herramientas de la oficina se conservan.

El estado actual del encargo aparece en una única franja junto al cuadro de escritura, con
color, símbolo y texto: amarillo mientras comprueba o trabaja, verde al completar,
rojo si falla y naranja si necesita revisión o está en pausa. Cancelado y pendiente
de confirmación usan un indicador neutro. Al confirmar se muestra inmediatamente
la comprobación de cuota. El verde indica finalización de la ejecución; revisa la
respuesta y sus comprobaciones antes de aprobar el resultado. Los estados guardados
siguen visibles al volver a abrir el historial.

Si falta comprobar el modelo o confirmar una pausa,
aparece un aviso naranja con el paso pendiente y el botón dice **Revisar antes
de ejecutar**. En el modo manual opcional, también se solicita revisar el presupuesto.
No se envía una ejecución hasta resolver esos requisitos; guardar cotas no ejecuta nada.

En **Ajustes avanzados**, el campo **Instrucciones adicionales** es opcional y
permanece oculto hasta desplegarlo: Codex recibe los `AGENTS.md`
aplicables y no necesitas copiar sus reglas en el formulario. Úsalo solo para
preferencias adicionales. La comprobación y el tratamiento de copias aisladas se
explican en [Instrucciones del proyecto](INSTRUCCIONES_PROYECTO.md).

## Permisos permanentes del proyecto

La autonomía está activada por defecto. Enviar es la autorización para trabajar:
no hay confirmaciones adicionales de escritura o cuota por encargo. La preferencia
se guarda al primer envío o al cambiarla en **Ajustes del proyecto**. Los proyectos
existentes también usan este recorrido salvo que se desactive explícitamente.
Las pruebas locales compatibles quedan autorizadas, incluidos cambios en sus
scripts dentro del proyecto; se mantiene la verificación oficial de suscripción.
La escritura corresponde al Programador; los revisores mantienen su independencia.

Puedes desmarcar **Trabajar con autonomía en este proyecto** para recuperar las
confirmaciones manuales. El presupuesto manual sigue siendo una opción avanzada.
Un encargo preparado antes de esta actualización se inicia con **Ejecutar**,
comprobando disponibilidad y aplicando el permiso permanente del proyecto.

Si una ejecución termina sin comunicar sus tokens, el recibo se conserva como
desconocido y ese intento se pausa. Un nuevo envío o **Ejecutar** en el chat normal
comprueba la cuota actual mediante el CLI oficial antes de continuar. No borra el
recibo anterior, no transforma datos ausentes en cero ni reinicia contadores. La
cola avanzada y el presupuesto manual siguen exigiendo consumo histórico verificable.

### Confirmaciones manuales y TURBO

Con la autonomía desactivada, cada mensaje es de solo lectura. Marca **Permitir cambios en archivos
para este mensaje** si necesitas modificaciones; el resumen agrupa ese permiso y
el uso de cuota en una sola confirmación. La autorización corresponde a ese encargo
y al resumen mostrado: si cambian modelo, permisos o límites, tendrás que confirmar
el resumen actualizado.

En **Ajustes del proyecto** puedes activar **TURBO** tras confirmar su alcance.
Permite cambios futuros en los archivos de ese proyecto, sin repetir la petición
de permiso de escritura en cada mensaje. Se conserva al reiniciar y se puede
desactivar desde el mismo apartado. No se aplica a los otros proyectos.

TURBO mantiene la confirmación **Usar cuota y ejecutar**. No eleva presupuestos,
reanuda pausas, omite revisiones de consumo ni desactiva el aislamiento del CLI.
Cada ejecución sigue verificando la suscripción y su cuota incluida. El permiso de
TURBO no autoriza compras, recargas ni proveedores alternativos.

El resumen de confirmación no es una autorización duradera de ejecución. Después
de un reinicio o un reintento se necesita una confirmación nueva; la cola genérica
no ejecuta mensajes del chat que todavía estén por confirmar.

## Presupuesto normal y manual

El chat utiliza por defecto **modo Codex**. El servidor lo selecciona al preparar
el mensaje y lo incluye en el resumen de confirmación. No exige muestras previas,
estimaciones del Jefe ni las tres cotas manuales. No envía un tope local de tokens
al ejecutor y no detiene este encargo por los contadores acumulados de la cola.
Codex gestiona su contexto y compactación con sus opciones habituales; compactar
no repone cuota de suscripción.

Se conservan la verificación oficial de cuota antes y durante la ejecución,
permisos de archivos, cancelación, almacenamiento seguro y pausas por errores o
consumo desconocido. El modo normal no impone un corte fijo por duración: puede
continuar durante horas mientras la ejecución y la cuota sigan verificadas. El
consumo real se sigue registrando, y no se reinician contadores al cambiar de modo.

Para imponer cotas adicionales, abre **Ajustes avanzados del encargo** antes de
enviar y marca **Usar presupuesto manual para este encargo**. Ese mensaje conserva
la política anterior de estimación y revisión humana. La cola avanzada y los flujos
con varios trabajadores mantienen sus presupuestos, reservas y límites originales.
TURBO cambia solo el permiso de archivos, no el modo de presupuesto.

Por defecto está marcada **El Jefe coordina al equipo hasta completar el objetivo**.
La confirmación autoriza las subtareas necesarias del mismo objetivo y su consumo
de cuota. El Jefe recibe entregas, decide el siguiente encargo y pide revisión al
Tester antes de terminar. Puedes desmarcarla para una ejecución individual.
Consulta [Oficina iterativa](OFICINA_ITERATIVA.md) para los controles y límites reales.

Al reiniciar, los mensajes antiguos que no tenían un modo explícito se recuperan
en modo normal, con una confirmación nueva. Esto no ejecuta ni reanuda nada. Los
mensajes preparados expresamente en modo manual conservan esa elección. Para
cambiarla, usa **Volver al mensaje** y envíalo con la opción manual desmarcada.
Las pausas de consumo desconocido siguen requiriendo revisión.

Esta mejora no transforma el chat en una sesión continua del proveedor: el motor
directo sigue abriendo un turno nuevo por encargo y la oficina aporta el contexto
reciente guardado. La compactación nativa ocurre dentro de la sesión del CLI; no
se promete recuperar automáticamente todo el contexto interno entre encargos.

## Proyectos y pruebas

Cada proyecto recuerda su nombre, carpeta, instrucciones y último contrato acotado
guardado. Ese contrato conserva archivos, decisiones, aceptación y pruebas; no se
presupone que cubra cualquier petición posterior. Revísalo si cambia el encargo.

En **Pruebas del proyecto** puedes revisar y aprobar las comprobaciones que el
servidor encuentra en su configuración npm: `check-types`, `lint`, `test` y
`package`, cuando existen. Se muestran también sus pasos previos y posteriores.
El navegador no puede proporcionar ejecutables ni registrar comandos arbitrarios.
La aprobación se guarda con la huella de `package.json` y la ruta de npm; un cambio
de esa configuración invalida la aprobación. También puedes desmarcar y guardar
para retirar una aprobación. Solo se ejecutan las pruebas que el encargo incluye.

Ejecutar una prueba satisfactoria no demuestra por sí solo que se hayan cumplido
todos los requisitos. Las pruebas generales no reciben cobertura de requisitos
inventada; se mantienen los controles de revisión independiente del motor.
Los proyectos sin esas comprobaciones npm siguen admitiendo conversaciones, pero
la oficina no inventa un verificador ni marca su aceptación como acreditada.

## Lectura y estados del encargo

Al abrir o crear una conversación, «Proyecto e historial» se recoge en una barra.
Puedes desplegarla para cambiar de proyecto, abrir otro chat o ajustar sus opciones.
Cerrar esta navegación no borra formularios guardados, conversaciones ni borradores.

Las respuestas se presentan con formato Markdown: negritas, cursivas, títulos,
listas, tablas y código. Los bloques de código conservan los caracteres literales.
El texto original sigue guardado y exportado; el formato también se aplica al
historial existente. El HTML de una respuesta no se ejecuta.

«Estado del encargo» muestra el estado registrado del último objetivo de esa
conversación, el motivo conocido y el siguiente paso. Los códigos técnicos se
pueden consultar desplegando «Detalles del estado». Los mensajes de los empleados
no deciden ese estado: procede del servidor y sus comprobaciones.

Si cambian los archivos durante un análisis de solo lectura, la oficina pausa el
objetivo con `project_changed_during_read`. Detectar diferencias no identifica al
autor de los cambios, por lo que no se acusa al empleado. Las entregas se conservan
y es necesario revisar el proyecto actualizado antes de continuar. Los avisos
antiguos con `review_changed_files` se muestran con esta explicación neutral sin
reescribir el historial privado. Una pausa nunca se reanuda por abrir el chat.

## Almacenamiento y recuperación

El arranque standalone configura el archivo `conversations.json` bajo el directorio
privado de estado adaptativo de esa oficina: en Windows, dentro de
`LOCALAPPDATA/AgentsSims/adaptive/<identificador>/library/`. No está en el repositorio
editable ni es un servicio remoto. No contiene credenciales, pero sí mensajes,
respuestas, instrucciones y rutas privadas: protege sus copias como tus documentos.

Las escrituras sustituyen el archivo mediante un temporal y mantienen una copia
anterior `.bak`. Si el principal no se puede leer, se intenta recuperar esa copia
y se avisa de que los últimos mensajes podrían faltar. El archivo dañado se
conserva. Si tampoco se puede leer la copia, se bloquean las escrituras y los nuevos
encargos; nunca se reemplazan los datos ilegibles por un historial vacío.
Un error al guardar pausa el trabajo y muestra un aviso; no debe cerrarse la oficina
hasta resolverlo. No es una garantía frente a averías del disco: descarga copias
de las conversaciones que necesites conservar por separado.

Las conversaciones se guardan aparte de la cola de ejecución. Una carpeta movida
o un checkpoint inválido no borran su archivo de historial. El proyecto debe volver
a estar disponible antes de ejecutar nuevos encargos sobre él. Leer un historial
no exige que la carpeta siga existiendo.

Las respuestas nuevas se conservan completas, aunque la tarjeta del encargo solo
muestre un resumen de 20.000 caracteres. Las tareas anteriores a esta función se
incorporan con el contenido disponible en su checkpoint; no se recupera texto que
ya hubiera sido recortado. El límite actual del archivo es 64 MiB: al alcanzarlo se
bloquean nuevos guardados sin borrar mensajes. No hay sincronización entre equipos
ni importación o compactación automática de archivos exportados.

Para continuar un encargo se prepara una ejecución nueva con las instrucciones del
proyecto y un contexto reciente acotado: hasta ocho mensajes anteriores, de hasta
1.500 caracteres cada uno. El historial visible conserva el texto completo. Esto
no promete continuar la misma sesión del CLI ni mandar todo el historial al modelo;
las revisiones independientes no reciben la conversación del autor.

Al crecer la cola se pueden retirar de ella encargos terminados sin dependencias
ni flujos asociados, conservando sus mensajes en el historial. No se libera
presupuesto, se borran mensajes ni se reanudan tareas por esa retirada.

La entrega completada del Jefe se presenta después de la actividad de su objetivo,
con la etiqueta **Resumen final**. El mensaje se actualiza en su posición original
del archivo, pero el orden de presentación lo sitúa al terminar, antes de una
petición independiente posterior. Los mensajes históricos no se reescriben. Esta
presentación reconoce también el cierre antiguo de la oficina tras retirar sus
encargos de la cola; no reclasifica respuestas individuales ni pausas como finales.
El seguimiento del chat considera esa entrega final y conserva la posición si la
persona está leyendo mensajes anteriores. El Jefe recibe instrucciones de resumir
resultado, comprobaciones y pendientes en pocas frases o hasta tres puntos.

Comprobado con 13 pruebas de presentación y estados, 55 de coordinación e historial,
tipos, lint y compilación correctos. En la conversación real de Vercel el resumen
pasó del segundo mensaje almacenado al último de los 26 presentados, sin modificar
el archivo. Tras actualizar inactivo, los cuatro chats y 72 mensajes conservaron
hash idéntico. La aceptación visual permanece pendiente.
