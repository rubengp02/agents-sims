# Propuesta del Jefe: selección y ejecución de modelos

Estado: propuesta para decidir la interfaz. No implementa selección ni ejecución en Pixel Office, no cambia configuraciones globales, no activa Claude y no inicia consultas a modelos.

Requisito obligatorio posterior: la versión personal funcionará exclusivamente con las sesiones de suscripción de los CLIs oficiales. No hay alternativa API de pago, recargas ni uso de créditos adicionales, tampoco por elección manual del Jefe o del usuario dentro de esta aplicación. Si la vía de suscripción no se puede verificar, la ejecución se bloquea. La revisión del código y el orden de implementación están en `pixel-office/docs/REVISION_SOLO_SUSCRIPCIONES.md`, relativo a la raíz de trabajo.

## Lo que verá el usuario

Se conservan las dos distribuciones con las mismas funciones, por decisión del usuario. **Automático será el modo predeterminado.**

- **Oficina y panel:** mantiene una referencia de la oficina original, muestra personaje, modelo y razonamiento; al seleccionar un personaje aparece su tarea, motivo de selección, controles y límites.
- **Mesa de asignaciones:** reúne los personajes y sus combinaciones en una lista, con el mismo panel de detalle.

Los personajes de la propuesta reutilizan sprites originales. Las asociaciones entre aspecto y rol son ilustrativas y quedan a decisión del usuario. No se modifica la oficina instalada.

El panel distingue **modelo solicitado** y **modelo comunicado por el proveedor**. Antes del inicio, o cuando el proveedor no confirme un dato, muestra «Sin iniciar» o «No confirmado». No presenta una petición enviada como prueba de qué modelo la ejecutó.

Los tres modos son:

| Modo       | Funcionamiento propuesto                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Automático | El Jefe decide dentro de las reglas y límites fijados; el usuario puede intervenir.                                           |
| Manual     | El análisis se realiza, pero el usuario fija o confirma la combinación antes de ejecutar.                                     |
| Mixto      | El Jefe decide tareas dentro de los umbrales; esfuerzo, coste estimado o riesgo que excedan el umbral requieren confirmación. |

Se puede fijar una elección para una tarea o para un personaje en un proyecto. La configuración global sería el valor por defecto, con reglas particulares por proyecto. En una tarea en curso, cambiar de modelo se aplicaría a un paso posterior compatible o exigiría pausa y nueva ejecución; no borra consumo ni garantiza migrar el contexto sin adaptación.

## Catálogo y dificultad

**Corrección posterior:** existen dos instalaciones de Codex. La 0.154.0, encontrada primero en el terminal, devolvía la lista reducida de abajo. La 0.163.0-alpha.10.2 sí anuncia GPT-6.1 Sol y GPT-6 Luna; el catálogo completo de metadatos está en `CATALOGO_LOCAL_RECIENTE.json`. No se ha probado inferencia. Las referencias anteriores a falta de disponibilidad describían solo la versión antigua, no una limitación demostrada de la cuenta. Véase la corrección en COMPARACION_Y_AHORRO.md.

La consulta de solo lectura al `model/list` del Codex local, realizada el 20 de octubre de 2026, devolvió:

- `gpt-6-astra`: low, medium, high, xhigh, max, ultra.
- `gpt-5.6-sol`: low, medium, high, xhigh, max, ultra.
- `gpt-5.6-terra`: low, medium, high, xhigh, max, ultra.
- `gpt-5.6-luna`: low, medium, high, xhigh, max.

Estos datos son lo anunciado por el catálogo del perfil local en ese momento, repetido en `CATALOGO_LOCAL.json` sin ejecutar inferencia. La comparación de tarifas oficiales, las restricciones del catálogo y la política de ahorro se detallan en [COMPARACION_Y_AHORRO.md](COMPARACION_Y_AHORRO.md). GPT-6.1 Sol y GPT-6 Luna son candidatos preferentes pendientes de aparecer en este CLI. No implica que todos los modelos sigan disponibles en otra cuenta o fecha. La interfaz implementada deberá refrescar capacidades y tratar un rechazo como un bloqueo real, sin sustituirlo silenciosamente.

Claude permanece desactivado y no se considera candidato. La ausencia de autenticación, una integración desactivada, un modelo vetado o un esfuerzo no admitido excluyen una combinación de la selección.

El análisis real valoraría alcance, dependencias, incertidumbre, necesidad de imágenes o herramientas, reversibilidad y criterios de aceptación. Su resultado sería una clasificación explicable y revisable, con confianza limitada y motivos breves, sin publicar razonamiento interno oculto. Una clasificación dudosa se elevaría o pediría revisión según la política; no se asigna siempre el modelo de mayor capacidad.

El propio análisis del Jefe debe tener un modelo inicial permitido y un presupuesto. Su coste y los reintentos cuentan en los límites. El prototipo utiliza una regla de ejemplo claramente identificada como simulación, no un clasificador de IA ya construido.

## Control real de ejecución

Flujo previsto: petición → análisis → catálogo elegible → aplicación de reglas → plan de asignación → confirmación cuando corresponda → ejecutor → eventos de actividad y consumo → resultado.

La interfaz debe enviar al servidor una decisión verificable que incluya tarea, proyecto, rol, proveedor, modelo, esfuerzo nativo, motivo breve, límites y versión de política. El servidor vuelve a validar la combinación al comenzar. Las mismas validaciones se aplican a cambios manuales, que pueden modificar explícitamente la política pero no saltársela en silencio.

El ejecutor será la autoridad para iniciar, seguir, detener y contabilizar procesos. Lanzará con argumentos estructurados, sin construir comandos shell a partir de texto del usuario. No añadirá commits, push ni cambios de rama sin autorización.

El registro distinguirá planificación, espera de confirmación, inicio solicitado, inicio comunicado, actividad, fin, cancelación y fallo. La oficina animará eventos reales de estas ejecuciones. No anunciará un personaje trabajando basándose solo en una asignación propuesta.

Para que la selección gobierne realmente una tarea, esta debe pasar por el ejecutor del Jefe o por un adaptador oficial de control. Leer las transcripciones de un chat externo solo permite observarlo; no permite cambiar retroactivamente su modelo ni garantizar interceptar todos los mensajes de todos los clientes.

## Integraciones intercambiables

Cada adaptador expondrá las mismas operaciones conceptuales: descubrir capacidades, validar una elección, ejecutar, transmitir eventos, cancelar y comunicar consumo. Los modelos y niveles de razonamiento pertenecen al proveedor; la aplicación mostrará etiquetas comprensibles y conservará sus valores nativos sin asumir equivalencia entre proveedores.

- **Codex:** controlar tareas con su interfaz oficial App Server, consultando `model/list` y los métodos de conversación y turno correspondientes a la versión instalada. Validar el protocolo antes de implementar; no sustituirlo automáticamente por una API facturable.
- **Claude Code:** cuando esté instalado, autenticado y activado, usar una integración oficial de su CLI con modelo y esfuerzo explícitos y eventos estructurados. Los parámetros soportados dependen de versión, modelo y cuenta; no se inventa acceso a partir del nombre público de un modelo.
- **Google Antigravity:** reservar el adaptador y su contrato, manteniéndolo no disponible hasta verificar e implementar una integración oficial. No se presupone que exista una API concreta ni que exponga los mismos controles.

Las sesiones y credenciales se mantendrán separadas por proveedor y perfil. La disponibilidad de dos suscripciones no se suma ni implica rotación automática de cuentas.

## Límites y consumo honesto

- Lista de modelos permitidos o excluidos, con esfuerzo máximo por regla.
- Límite de ejecuciones y reintentos, concurrencia y duración, con alcance por tarea, proyecto o periodo.
- Objetivo de tokens cuando haya telemetría; indicar si se puede imponer como corte o solo supervisar. Contar también Jefe, especialistas, reintentos y cancelaciones.
- Reserva compartida de presupuesto antes de despachar tareas simultáneas, para evitar que varias gasten el mismo saldo disponible.
- Límite monetario solo si el proveedor y la vía de facturación permiten medirlo con tarifas verificadas. Sin una tarifa o medida fiable, mostrar desconocido y mantener deshabilitado el gasto API automático.
- Al llegar al límite: bloquear nuevas ejecuciones y solicitar interrupción de las activas según su soporte. No prometer corte exacto de tokens o factura: la última llamada o cancelación puede producir consumo adicional.
- Los datos de una cuota de suscripción no se convierten artificialmente en euros. No se inicia una vía API de pago como alternativa implícita a una suscripción.

El usuario puede cambiar manualmente una decisión o sus límites. Si una combinación no está disponible, se explica el motivo y se pausa o propone una alternativa que ya esté autorizada. Los cambios de proveedor y sus motivos quedan visibles.

## Fuentes oficiales consultadas

- [Codex App Server: modelos y control de turnos](https://learn.chatgpt.com/docs/app-server).
- [Claude Code: configuración de modelos](https://code.claude.com/docs/en/model-config).
- [Claude Code: parámetros CLI, esfuerzo y presupuesto estimado](https://code.claude.com/docs/en/cli-reference).

Claude documenta que `--max-budget-usd` usa una estimación cliente en modo print y puede sobrepasar el importe; no constituye una garantía de factura exacta.

## Qué debe decidirse antes de implementar

Ambas distribuciones y Auto predeterminado quedan aceptados. Queda revisar la asociación de personajes con roles y concretar los umbrales del modo mixto al implementar. Los valores numéricos y asignaciones son ejemplos editables, no límites activos. La prioridad de minimizar consumo sí es un requisito explícito del usuario; el Jefe debe escoger dentro de la política eficiente descrita en COMPARACION_Y_AHORRO.md.

## Comprobación de la propuesta

Se probó en Edge la selección de personajes, el cambio manual de modelo y esfuerzo, la exclusión de modelos, los tres modos, los límites de ejemplo y los escenarios explícitos de prueba. La revisión de ahorro comprueba Auto inicial, modelos sin acceso local deshabilitados, personajes en espera y que habilitar excepciones manuales no amplía Auto. Ambas distribuciones se comprobaron a 1024, 736, 375 y 320 píxeles, sin desbordamiento horizontal ni errores JavaScript. La revisión inicial también inspeccionó las vistas clara y oscura. El script `validar-propuesta.mjs` permite repetir la comprobación local con una ruta a la vista previa renderizada.

La revisión propia considera actualizada la propuesta visual según las decisiones del usuario; la implementación del ejecutor y la evaluación de calidad de modelos siguen pendientes. La consulta de catálogo no se presenta como prueba de ejecución ni de consumo. No se han repetido los tests de la aplicación porque esta fase no modifica sus fuentes.
