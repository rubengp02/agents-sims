# Oficina iterativa

En Conversaciones, selecciona proyecto, escribe el objetivo y conserva marcada
**El Jefe coordina al equipo hasta completar el objetivo**. Enviar inicia el trabajo:
la autonomía permanente del proyecto autoriza escritura, herramientas, pruebas
locales y llamadas de cuota incluidas. No se confirma cada encargo o subtarea.
Se puede recuperar el recorrido manual desde los ajustes del proyecto.

El Jefe decide el siguiente trabajo, lo encarga al especialista, recibe su entrega
y vuelve a decidir. Arquitecto y Diseñador asesoran; el Programador implementa;
el Tester revisa de forma independiente. Las entregas relevantes se pasan al
siguiente responsable y aparecen guardadas en el chat. La actividad muestra quién
trabaja y la decisión actual. **Detener la oficina** cancela todo el objetivo.

El Jefe conserva una misma conversación de Codex durante el objetivo mediante
`thread/resume`. Cada intervención verifica de nuevo cuenta, cuota, modelo,
carpeta y permisos, y renueva la conexión MCP. El proceso App Server se cierra
entre intervenciones; la conversación se conserva. Cada recibo cuenta solamente
el consumo nuevo, no vuelve a sumar los turnos anteriores. Un fallo al retomar
la sesión pausa el encargo sin abrir otra conversación silenciosamente.
Los especialistas siguen teniendo conversaciones independientes.

La memoria estructurada registra objetivo, revisiones e indicaciones del usuario,
decisiones completas del Jefe, identificadores y extractos señalados de todas las
entregas y comprobaciones. No se limita a las ocho entregas recientes. El Jefe
recibe un resumen con el índice completo y puede consultar `office_memory` para
recuperar decisiones anteriores. Los informes originales permanecen en las tareas;
los extractos no sustituyen los archivos ni acreditan pruebas.
El checkpoint conserva los registros necesarios para reconstruir esta memoria.
Después de reiniciar el servidor, un reintento explícito reconstruye la memoria
en una conversación nueva: no restaura procesos, permisos ni aceptación anterior.

El equipo se ajusta al alcance: una explicación pequeña puede estudiarla el Jefe
y contrastarla el Tester; un cambio acotado empieza con Programador y Tester.
Arquitecto y Diseñador requieren una necesidad concreta. El tamaño recomendado
se recalcula con las nuevas indicaciones del usuario; no es un tope ni reduce la
revisión independiente exigida para cerrar el objetivo.

La ejecución actual es secuencial: un empleado trabaja por turno. Evita conflictos
de archivos y permite que el Jefe incorpore cada resultado antes de encargar más.
No hay límite fijo de minutos ni de rondas útiles en este modo. Los flujos de la
cola avanzada y el presupuesto manual mantienen sus controles anteriores.

El Jefe tiene autorización explícita para asignar especialistas mediante
`OFFICE_DECISION`; el servidor inicia sus turnos con sus permisos y control de cuota.
La restricción de iniciar CLIs de IA o subagentes por cuenta propia no prohíbe esas
asignaciones. Las entregas antiguas no crean nuevas órdenes del usuario.
Si falta una revisión, el Jefe la encarga al Tester antes de pedir ayuda humana.
Para analizar un proyecto, el Arquitecto prepara la entrega y el Tester la contrasta
con los archivos. Este recorrido puede terminar aunque no haya cambios de código.

## Controles del servidor

- La decisión del Jefe solo puede asignar un papel permitido, solicitar intervención
  humana o proponer finalizar. No puede activar permisos, comandos, modelos nuevos,
  publicación ni proveedores. Cada llamada conserva el control de suscripción.
- Cada empleado tiene sesión propia. Solo el Programador hereda el permiso de
  escritura del objetivo; Jefe, Arquitecto, Diseñador y Tester son de solo lectura.
- Tras implementar, se ejecutan las comprobaciones locales autorizadas por la
  autonomía permanente del proyecto o, en modo manual, aprobadas expresamente.
  Los fallos reparables vuelven al Jefe para encargar correcciones. Se requiere una
  revisión del Tester posterior al último cambio antes de cerrar.
- Para cambios de archivos se captura el contenido inicial y se compara con el final.
  Las carpetas normales no necesitan un repositorio: no se inicializa Git ni se
  modifica su configuración. Se excluyen dependencias, cachés, resultados temporales
  de pruebas, estado privado de la oficina y archivos `.env` de credenciales. Se
  incluyen las plantillas `.env.example`, `.env.sample` y `.env.template`.
  Los repositorios dentro de la carpeta conservan sus propias reglas de exclusión;
  un repositorio dañado sigue necesitando revisión y no se ignora su error.
  El Tester recibe criterios, diff y resultados de pruebas, sin conversación privada
  del autor. Los hallazgos referencian archivos, líneas, criterios y evidencia.
  Cuando solo se han producido análisis, recibe las entregas públicas de los
  especialistas, con indicación de cualquier abreviación, para poder revisarlas.
- Tres entregas con la misma evidencia del mismo papel pausan el ciclo. Para código,
  la evidencia usa contenido y comprobaciones; para análisis, estado y texto de la
  entrega. Es una protección contra repeticiones, no una prueba de progreso semántico.
- Una pérdida de cuota, permisos, persistencia o evidencia pausa el objetivo. No hay
  reanudación automática tras una pausa, cancelación o reinicio. El historial queda
  disponible; el consentimiento de ejecución no se restaura desde disco.

## Alcance comprobado

El modo iterativo utiliza por defecto Codex App Server mediante el CLI oficial.
El ejecutor CLI anterior conserva compatibilidad explícita, sin reutilizar la
conversación del Jefe. La integración AO conserva sus flujos
anteriores, pero no admite aún este ciclo sobre una copia compartida y no cambia
de motor silenciosamente. La opción individual permanece disponible.

Las pruebas locales usan ejecutores simulados y procesos locales de comprobación:
verifican coordinación, corrección, revisión, cancelación y persistencia sin cuota.
No equivalen a una evaluación real con modelos. El contrato valida permisos y
evidencias estructurales; la calidad del juicio del Jefe y del Tester y la aceptación
del producto siguen necesitando evaluación y revisión humana.

Validación local del 22 de octubre de 2026: 778 pruebas del servidor, 59 de la
interfaz, 11 de contratos y contexto, y 3 recorridos de navegador aprobados.
También se compiló y probó el puente AO con un proveedor simulado, sin inferencia.
El recorrido de navegador incluye una autorización, comunicaciones del equipo,
revisión, resultado legible y recuperación del historial después de reiniciar.
La actualización de autonomía añade el envío directo sin confirmaciones, pruebas
locales autorizadas por proyecto y conservación del permiso después de reiniciar.
La revisión de carpetas sin Git se verificó además en 43 pruebas específicas,
incluida la recuperación de un encargo bloqueado por el requisito anterior, y en
el recorrido de navegador sin crear un repositorio en la carpeta de prueba.
La recuperación de consumo incompleto conserva el recibo desconocido y los
contadores anteriores. El reintento explícito del chat normal verifica cuota actual;
la cola y los presupuestos manuales siguen bloqueados sin un total histórico fiable.
El navegador verifica también un fallo antes de la primera decisión y la posterior
finalización del objetivo, sin restablecer contadores ni declarar conocido el pasado.
La corrección de coordinación verifica el prompt completo del Jefe, los límites de
los especialistas y el recorrido de resumen con Arquitecto y Tester. Se comprobó
con ejecutores simulados; no se lanzó otra ejecución real del encargo del usuario.

## Personajes y sesiones observadas

La oficina principal muestra únicamente empleados creados por el coordinador al
ejecutar encargos. Cada etiqueta indica su función, proyecto y estado en español:
Trabajando, Disponible, Terminado o En pausa. Un empleado que termina conserva su
personaje durante la sesión del servidor; no se crean empleados de muestra al abrir.

El botón «Otras sesiones de Codex» permite consultar las sesiones externas
detectadas. Se conservan registradas, pero no ocupan puestos ni se presentan como
empleados del Jefe. Abrir esta lista no inicia modelos ni consume cuota. Esta
separación corresponde a la oficina local; la integración con VS Code conserva su
vista de sesiones.
