# Tu oficina de agentes

La aplicación está instalada en la raíz de este repositorio, conservando el diseño original.

1. Haz doble clic en **ABRIR-OFICINA.cmd**. Se abrirá el navegador.
2. Trabaja con Codex como haces normalmente. Las sesiones locales con actividad aparecen como personajes.
3. Usa **+ / −** para acercar o alejar la vista.
4. **Layout** abre el editor de la oficina. **Settings** contiene los ajustes, la importación y la exportación.
5. Para apagarla, haz doble clic en **CERRAR-OFICINA.cmd**. Cerrar únicamente el navegador deja la oficina funcionando.

Dirección: <http://127.0.0.1:4173>.

Después de reiniciar Windows, vuelve a usar **ABRIR-OFICINA.cmd**. Si reinicias la oficina con el navegador abierto, actualiza la página.

## Codex y Claude

Codex está activado. Claude Code y Hermes están desactivados, pero su código sigue disponible.
No necesitas Claude ni una clave de API para ver tu actividad de Codex. No se han cambiado tus cuentas.

La oficina muestra actividad. Ya puedes encargar una tarea con **EJECUTAR-TAREA.cmd**, que usa Codex CLI con tu sesión de ChatGPT y vuelve a comprobar suscripción, cuota y ausencia de créditos adicionales antes de arrancar. **COMPROBAR-AGENTES.cmd** consulta el estado sin enviar una tarea a la IA. Tus dos suscripciones no se convierten automáticamente en dos personajes ni se combinan: cada personaje representa una sesión local detectada. Las sesiones en otro ordenador o usuario no se conectan automáticamente.

Las pruebas automáticas usan datos simulados en carpetas temporales. También se han hecho comprobaciones reales breves de Codex con razonamiento bajo, después de verificar sesión y cuota, sin herramientas ni cambios en archivos.

## Ejecutar una tarea

1. Abre la oficina con **ABRIR-OFICINA.cmd**.
2. Abre **EJECUTAR-TAREA.cmd**.
3. Escribe la ruta completa de la carpeta del proyecto y después la tarea.
4. Verás la respuesta en esa ventana; la oficina observará la sesión cuando Codex publique su actividad. Puedes interrumpir con **Ctrl+C**.

Este lanzador usa GPT-6.1 Sol con razonamiento bajo y **solo lectura** por defecto. El cambio explícito de modelo, razonamiento y permiso para editar está documentado en [Ejecución oficial](docs/EJECUCION_OFICIAL.md).

## Encargar trabajo al equipo desde la oficina

Pulsa **Equipo**. Se mantienen las dos vistas: **Oficina y panel** y **Mesa de asignaciones**.

1. Deja **Automático** y escribe la carpeta del proyecto y tu objetivo.
2. Para algo sencillo, elige personaje y pulsa **Añadir tarea sin plan**. Para varios pasos, **Pedir plan al Jefe** prepara las tareas usando una llamada.
3. Revisa el plan y pulsa **Ejecutar cola**. Cada tarjeta muestra modelo solicitado, razonamiento, motivo de elección, estado y respuesta.
4. Puedes cambiar modelos, usar modo manual o mixto, ajustar límites y pausar el equipo.

El Jefe organiza el orden: puede hacer coincidir hasta dos análisis independientes
de solo lectura. Arquitectura y diseño preceden al código cuando forman parte del
plan, y el Tester espera a la implementación. Las escrituras se mantienen
exclusivas. Cada tarjeta indica si puede trabajar o qué resultado está esperando.

La ejecución real de Codex está conectada. Claude tiene adaptador e interruptor de comprobación, pero sigue bloqueado: su CLI no permite demostrar previamente que el consumo adicional de pago esté desactivado. No se utilizará una clave API para resolverlo.

Los planes y respuestas se conservan mientras el servidor siga abierto. Reiniciarlo vacía la cola. Los límites se guardan. **Pedir plan al Jefe** genera un plan; **Ejecutar cola** arranca el trabajo. El modo manual utiliza tareas añadidas directamente.

Consulta [Uso del equipo y límites](docs/EQUIPO_MULTIAGENTE.md) para más información.

Por defecto se observan las sesiones locales de todos los proyectos de Codex. Puedes cambiar **Watch All Sessions** en Settings; el próximo arranque vuelve a aplicar el valor de `office.config.json`. Con Codex conviene dejarlo activo: el filtro original de proyectos está pensado para Claude.

Si todavía no aparece ningún personaje, encarga una tarea a Codex y espera unos segundos. Las sesiones sin actividad reciente pueden no aparecer y los personajes pueden retirarse tras unos diez minutos de inactividad. No representan una medida exacta de si el proceso de Codex sigue abierto.

## Cambios de diseño

No se ha rediseñado la aplicación. El editor original permite modificar la distribución, suelos, paredes y mobiliario; los ajustes permiten cargar paquetes externos. Editar visualmente absolutamente todos los aspectos todavía no es una función existente: lo iremos construyendo según tus decisiones.

Google Antigravity no está integrado. Se conserva la separación por integraciones para estudiar una conexión oficial más adelante.

## Más información

- [Instalación, comprobaciones y límites](docs/INSTALACION_LOCAL.md).
- [Proyecto original](https://github.com/josephndex/pixel-office).
- [Licencia original conservada](LICENSE).
