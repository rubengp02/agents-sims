# Oficina real frente a referencia directa conservada

21 de octubre de 2026. Por indicación del usuario no se repitió Codex directo:
se conservó el resultado aceptado del ensayo `revalidacion-20261021-b` y se fijó
su hash en la preparación. El hash de los archivos iniciales coincide. Mismo caso
medio, contrato, modelo solicitado gpt-6.1-sol y razonamiento medium. El proveedor
no comunicó modelo confirmado. Las condiciones de caché y carga pueden variar:
esta comparación usa una referencia anterior, no una pareja simultánea aleatoria.

## Resultados medidos

| Método                             | Entrada | Salida | Caché incluida en entrada |   Total |    Tiempo |
| ---------------------------------- | ------: | -----: | ------------------------: | ------: | --------: |
| Codex directo, referencia anterior |  58.064 |  2.277 |                    45.184 |  60.341 |  71,676 s |
| Oficina, tres llamadas nuevas      | 203.890 |  5.747 |                   131.584 | 209.637 | 194,190 s |

Ambas implementaciones superan las 36 comprobaciones externas y las pruebas
públicas. El resultado de la oficina **no se acepta como mejora**: excedió el
presupuesto y el Tester quedó en pausa. Frente a la referencia, consumió unas
3,47 veces los tokens y tardó unas 2,71 veces. Esto describe este caso concreto;
no demuestra comportamiento general en tareas fáciles o difíciles ni permite
convertir tokens en porcentaje exacto de cuota.

| Papel de oficina | Entrada | Salida | Caché incluida |  Total | Tiempo de ejecución |
| ---------------- | ------: | -----: | -------------: | -----: | ------------------: |
| Arquitecto       |  57.913 |  1.140 |         41.728 | 59.053 |            44,606 s |
| Programador      |  95.800 |  2.263 |         54.912 | 98.063 |            68,652 s |
| Tester           |  50.177 |  2.344 |         34.944 | 52.521 |            73,252 s |

Arquitecto y Programador completaron; el Tester terminó en `token_budget`.
Todas las llamadas verificaron suscripción y comenzaron sesiones nuevas.
La reutilización de caché no equivale a continuar sesiones ni a reutilizar
personajes. No se midió continuidad real en este ensayo.

Se asignó únicamente el presupuesto de oficina: tres llamadas, cuatro minutos,
200.000 tokens, máximo 180 segundos por llamada y reserva previa de 20.000 tokens.
No se añadieron los tokens de la referencia al consumo nuevo ni se asignó su
presupuesto a la oficina. Se consumieron tres llamadas y 194,256 s de tiempo
total del ensayo, sin reintentos ni reparaciones por IA. No hubo ampliaciones.

El contador nativo comunicó el consumo del último turno al cerrarlo. El control
detectó entonces un exceso de 9.637 tokens sobre el presupuesto y pausó. Es un
límite sobre consumo comunicado, no un tope de generación garantizado por el
proveedor. La reserva de 20.000 tokens no bastó para anticipar un turno de 52.521.
No se ha corregido este resultado ni se ha autorizado otra llamada.

## Alcance y auditoría local

La reparación anterior de rutas permitió crear el espacio aislado y ejecutar la
implementación y revisión reales. La comprobación estricta de bytes también marcó
como cambiados AGENTS.md, TASK.md, contract.test.mjs y package.json. La auditoría
local confirmó que sus contenidos son idénticos salvo LF frente a CRLF; no se
encontraron cambios de instrucciones ni pruebas por parte del modelo.

El registro original mantiene esa comprobación de alcance como fallida, sin
reescribirla para declarar éxito. Para futuros ensayos se fijó
`core.autocrlf=false` exclusivamente en el repositorio desechable de cada método;
no se alteró la configuración global ni el proyecto del usuario. Una prueba
local de checkout verificó igualdad exacta de los cuatro archivos. Su primer
intento diagnóstico tenía una ruta demasiado larga; se conservó y se repitió con
una ruta corta, sin IA. Evidencia: [AUDITORIA_LOCAL.json](AUDITORIA_LOCAL.json).

Los cinco escenarios del puente pasaron antes de inferencia. Tras la mejora del
registrador y de las condiciones de Git pasaron sintaxis, formato y las 33 pruebas
locales de estudios/políticas/comparación. No se repitió la batería de aplicación
porque no se cambió el runtime después de su última validación completa.

## Decisión

El motor anterior sigue siendo el predeterminado. La integración ya ha demostrado
transmisión de respuestas, aislamiento e implementación reales, pero este reparto
de tres especialistas no aporta ventaja medida en la tarea media. Antes de gastar
en más ensayos conviene evaluar localmente reducir contexto y especialistas, y
mejorar la previsión del presupuesto por turno. Son propuestas pendientes, no
ahorros logrados. No se ha cambiado el diseño, activado Claude ni conectado
Antigravity. Los registros anteriores se conservan y este presupuesto está cerrado.

Evidencia: [preparación y referencia fijada](PREPARACION.json),
[resultado original](PILOTO_REAL.json). Respuestas, rutas personales y espacios de
trabajo permanecen privados en `.local-office/`.
