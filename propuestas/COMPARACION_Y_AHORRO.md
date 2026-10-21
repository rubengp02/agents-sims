# Selección eficiente del Jefe

Estado: propuesta revisada el 20 de octubre de 2026. Ambas vistas se conservan y **Auto será el modo predeterminado**, por decisión del usuario. La prioridad es minimizar el consumo total manteniendo la calidad necesaria. No hay aún ejecutor ni clasificador de tareas implementados en la aplicación.

## Corrección de disponibilidad local

Una comprobación posterior encontró dos instalaciones: el comando `codex` resuelve primero a 0.154.0, mientras que otra instalación local tiene 0.163.0-alpha.10.2. Con la misma consulta `model/list`, la primera anuncia cuatro modelos y la segunda siete, incluidos **GPT-6.1 Sol y GPT-6 Luna**. La evidencia más reciente está en `CATALOGO_LOCAL_RECIENTE.json`; el snapshot original se conserva en `CATALOGO_LOCAL.json` para trazabilidad. No se ha ejecutado inferencia, actualizado software ni cambiado el PATH.

Por tanto, las menciones a «sin acceso local» o «pendiente de disponibilidad» de la propuesta y comparación iniciales se limitaban al CLI antiguo: no describen la instalación reciente ni prueban falta de acceso de la cuenta. La tabla siguiente conserva la observación inicial del CLI 0.154.0. El futuro ejecutor debe seleccionar y comprobar su runtime explícitamente y usar el catálogo de ese runtime. La interfaz ilustrativa anterior todavía refleja el snapshot antiguo y se revisará con esta corrección al continuar su desarrollo.

## Comparación verificable

Precios API públicos Standard en USD por millón de tokens de texto, con entrada de hasta 272.000 tokens, sin recargos regionales, herramientas ni escritura de caché. Estos importes **no son la cuota ni la factura de las suscripciones de Codex**.

| Modelo        | Entrada | Entrada en caché | Salida | Anunciado por Codex local |
| ------------- | ------: | ---------------: | -----: | ------------------------- |
| GPT-6 Luna    |    0,10 |             0,01 |   0,50 | No                        |
| GPT-5.6 Luna  |    0,20 |             0,02 |   1,20 | Sí                        |
| GPT-6.1 Sol   |    2,00 |             0,10 |  10,00 | No                        |
| GPT-5.6 Terra |    2,00 |             0,20 |  12,00 | Sí                        |
| GPT-5.6 Sol   |    4,00 |             0,40 |  20,00 | Sí                        |
| GPT-6 Astra   |   10,00 |             1,00 |  50,00 | Sí                        |

Fuentes por fila: [6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra).

6.1 Sol cuesta un 50% menos por token de entrada y salida que 5.6 Sol, y un 75% menos por entrada en caché. Frente a Terra tiene igual precio de entrada, menor precio de salida y de caché. Eso permite descartar una preferencia automática por 5.6 Sol basada en una supuesta relación calidad/precio superior. **No prueba que una tarea use menos tokens, ni que 6.1 Sol gane siempre en calidad.** Las tarifas de 5.6 Sol son promocionales al menos hasta el 21 de noviembre de 2026; hay que revisarlas, no codificarlas como verdad permanente.

OpenAI describe 6.1 Sol como cercano a Astra para trabajo complejo a menor coste y recomienda contrastarlo en las tareas propias. Una [comparación oficial de mantenimiento de software](https://developers.openai.com/blog/maintaining-software-with-the-gpt-6-family) encontró diferencias de coste y de hallazgos según modelo y esfuerzo. Es evidencia de ese flujo concreto, no una clasificación universal ni una evaluación realizada en este proyecto.

La documentación de [Codex: precios y consumo](https://learn.chatgpt.com/docs/pricing) separa suscripciones, créditos y API; los multiplicadores de la cuota incluida pueden diferir de los de créditos adquiridos. No convertir precios API en porcentaje de cuota o ahorro garantizado de suscripción. Mostrar tokens, cuota comunicada y gasto monetario por separado; si falta telemetría, indicar desconocido.

La evidencia local está en `CATALOGO_LOCAL.json`: consulta de metadatos sin ejecutar inferencia. La aplicación de escritorio que sirve este chat y el CLI local pueden anunciar modelos distintos. La selección del futuro ejecutor se validará contra su propio proveedor, perfil y cliente, no contra el modelo de este chat ni solo contra el catálogo público.

## Catálogo reducido, fuera del control libre del Jefe

Política inicial propuesta, revisable por el usuario:

- **Tareas acotadas:** candidato preferente 6 Luna; 5.6 Luna es alternativa local provisional.
- **Trabajo general y complejo:** candidato preferente 6.1 Sol; Terra es alternativa local provisional que debe cumplir las pruebas del trabajo. Para una tarea crítica sin calidad suficiente demostrada se pausa o se solicita una excepción.
- **5.6 Sol:** excluido de Auto inicialmente; excepción manual o incorporación posterior justificada por una ventaja medida en una familia de tareas.
- **Astra:** excluido de Auto inicialmente; excepción manual para una necesidad concreta.
- **Claude:** desactivado. Antigravity: pendiente de integración oficial y comparación equivalente.

Son candidatos preferentes por evidencia pública de coste/capacidad, **no un conjunto óptimo certificado**. Los modelos nuevos no entran automáticamente al publicarse. Un catálogo versionado guarda fuente, fecha, capacidades, vía de facturación, esfuerzos nativos y evidencia por tipo de tarea. Disponibilidad efectiva, política, capacidades y presupuesto deben cumplirse conjuntamente. Ningún fallo autoriza cambiar de cuenta, activar Claude, contratar API o usar un modelo excluido.

## Reglas para ahorrar tokens sin degradar el resultado

1. Aplicar reglas locales directas a casos conocidos. No gastar una llamada de IA para decidir cada llamada trivial. El análisis mediante IA se reserva a ambigüedad real, con contexto acotado y su propio límite.
2. Clasificar alcance, riesgo, dependencias, incertidumbre, herramientas y criterios de aceptación. La longitud del mensaje y el personaje no determinan por sí solos el modelo.
3. Elegir la combinación permitida de menor consumo esperado que cumpla la calidad requerida. Valorar el coste completo por tarea resuelta: Jefe, entrada repetida, salida, razonamiento, especialistas y reintentos. Minimizar tokens y minimizar dinero son objetivos relacionados pero diferentes: registrar ambos y no inventar una equivalencia.
4. Empezar con esfuerzo bajo en tareas simples y medio en las habituales; alto solo con un motivo concreto por complejidad o fallo diagnosticado. Extra alto, máximo y ultra quedan fuera de la selección automática inicial. Nunca atribuir un número fijo de tokens a cada esfuerzo.
5. No escalar primero si la tarea difícil exige ya una combinación de mayor calidad: evitar gastar en una tentativa inadecuada. Un fallo diagnosticado permite como máximo un escalado adicional dentro del catálogo y presupuesto; no repetir ciegamente una llamada. Sin mejora viable, pausar y mostrar el motivo.
6. Activar solo los personajes necesarios. Los demás permanecen visibles en espera. Ejecutar pruebas deterministas antes de una revisión adicional con IA; evitar que cinco roles repitan siempre el mismo trabajo.
7. Compartir resúmenes breves y fragmentos pertinentes, conservar enlaces a evidencias y traer contexto adicional cuando haga falta. No reenviar todo el historial a cada especialista. Aprovechar caché solo si la integración la soporta y comunica; sin porcentaje de ahorro inventado.
8. Usar velocidad Standard por defecto y bloquear Fast/Ultrafast en la política automática inicial. Reservar presupuesto antes de cada ejecución y entre tareas simultáneas, incluyendo clasificación y escaladas. Al agotarlo, impedir nuevos pasos y solicitar detener los activos según soporte del proveedor.

El usuario puede cambiar cualquier decisión y modificar explícitamente las restricciones. Un cambio manual no debe abrir una excepción silenciosa: mostrar qué límite o exclusión modifica, para qué ámbito y qué modelo/esfuerzo solicita. El ejecutor volverá a validar la política en el servidor; los controles del navegador no serán la autoridad.

## Cómo sabremos qué combinaciones conservar

Comparar una muestra representativa de tareas propias, repetida con las mismas condiciones, herramientas, contexto y criterios. Medir cumplimiento de pruebas, revisión de calidad cuando sea necesaria, tokens totales incluyendo razonamiento cuando se exponga, tiempo y reintentos. Comparar **por familia de tareas y modelo/esfuerzo**, no solo por nombre o antigüedad. Excluir lo que cuesta más sin una mejora necesaria demostrada; mantener resultados inciertos como tales.

El benchmark real de modelos queda pendiente: no se han hecho llamadas de inferencia, consumido cuota para compararlos, ni inventado puntuaciones o tasas de éxito. Las pruebas actuales solo validan el comportamiento local de la propuesta interactiva.

## Interfaz revisada

Se conservan Oficina y panel y Mesa de asignaciones. Auto aparece seleccionado al abrir. Ambas muestran la política de ahorro, candidatos pendientes de acceso, exclusiones manuales, razón de esfuerzo y personajes en espera. El escenario de prueba es explícito: la propuesta no finge analizar semánticamente el texto libre. Seleccionar o confirmar aquí no controla ejecuciones reales.
