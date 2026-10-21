# Validación del circuito mínimo del Jefe

21 de octubre de 2026. Cero llamadas reales a modelos. Se revisa la primera
implementación adaptativa y se prepara un piloto nuevo; no se reutilizan los
presupuestos cerrados de los ensayos anteriores.

## Resultado local

Se comprobaron 20 situaciones concretas mediante el coordinador real y metadatos
simulados. Ninguna necesitó despachar siquiera un trabajador simulado para decidir.
Los contratos conocidos de uno, dos o tres módulos producen un Programador con
Sol/low. Si solo falta cobertura, se añade revisión localmente sin una llamada
de planificación. Los cambios delicados conservan Arquitecto, Programador y
revisión profunda; desconocimiento importante exige revisión de presupuesto
antes de gastar en un planificador de IA.

La cobertura declarada no sustituye a la evidencia del registro local. Las
explicaciones de seguridad/migraciones, cuando son de solo lectura y sin una
modificación solicitada, no necesitan un equipo completo. Sigue siendo una
clasificación conservadora con reglas: estos 20 casos no prueban comprensión
perfecta de cualquier petición en lenguaje natural.

## Fallos encontrados y reparados

Las primeras cuatro regresiones nuevas fallaron con el código anterior:

1. «Documenta y elimina el control de acceso» se reducía a un único trabajador
   porque el prefijo documental ocultaba el verbo de modificación.
2. El texto podía revelar riesgo alto, pero el Tester heredaba la etiqueta baja
   del solicitante y recibía revisión focalizada.
3. Una tarea clara sin cobertura completa intentaba pedir un plan al Jefe de IA,
   en lugar de añadir revisión mediante reglas locales.
4. Un plan generado podía rebajar el riesgo explícito del solicitante y omitir
   el Tester si declaraba cobertura.

La primera ejecución del corpus ampliado también detectó cuatro casos fallidos:
pruebas ausentes sin revisión profunda, migración de datos no reconocida como
acción delicada y dos peticiones documentales con falsos positivos por nombres
como «migración» y «cambios». Se corrigieron sin eliminar los casos ni cambiar
sus expectativas. El historial de ejecuciones del corpus conserva los fallos
en [INTENTOS.json](INTENTOS.json).

El riesgo efectivo se propaga a los trabajadores y al tipo de revisión. El riesgo
o incertidumbre altos indicados por el solicitante se conservan al validar el plan
de IA. La falta de pruebas requiere revisión profunda y, en selección automática,
razonamiento alto del Tester. No se rebaja revisión para que el presupuesto quepa.

## Comprobaciones superadas

- 59 pruebas de interfaz, 664 de servidor y 7 de empaquetado: **730 en total**.
- 33 comprobaciones anteriores de estudios/políticas y tres pruebas nuevas del
  bloqueo de autorización del piloto.
- Los 20 casos del Jefe, los 19 escenarios simulados de estrategias y los cinco
  escenarios nativos del puente AO.
- Tipos, lint y compilación. Se conserva el aviso previo de React; no se cambia
  el diseño para resolverlo.
- El código no cambió durante la verificación. La evidencia de esta etapa vive en
  esta subcarpeta, sin reemplazar las validaciones de la entrega anterior.

Resultados: [DECISIONES.json](DECISIONES.json),
[VALIDACION_LOCAL.json](VALIDACION_LOCAL.json), [SIMULACION.json](SIMULACION.json).
Los contadores simulados no se interpretan como consumo de modelos ni ahorro.

## Piloto preparado, pendiente de autorizar sus límites

El [plan fijado](piloto/PLAN.json) compara una nueva ejecución de la oficina con
la referencia directa aceptada: 36/36, 60.341 tokens y 71,676 segundos. No se
ejecutará de nuevo Codex directo. El mismo caso medio conserva los bytes iniciales,
el contrato completo, los archivos permitidos y las 36 pruebas independientes.

| Control                           | Valor                                              |
| --------------------------------- | -------------------------------------------------- |
| Modelo / razonamiento nuevo       | gpt-6.1-sol / low                                  |
| Motor                             | Agent Orchestrator opcional, solo para el piloto   |
| Selección                         | Jefe local; debe elegir exactamente un Programador |
| Máximo de ejecuciones reales      | 1                                                  |
| Tokens totales observados         | 120.000                                            |
| Tiempo total                      | 4 minutos                                          |
| Tiempo máximo del turno de modelo | 3 minutos                                          |
| Reparaciones y reintentos         | 0                                                  |
| Claude / Antigravity              | Desactivado / desconectado                         |

El límite es mayor que la referencia para permitir un intento útil y acotado, y
menor que el presupuesto de 200.000 de la oficina de tres especialistas. No procede
de un historial comparable suficiente de Sol/low; es una cota propuesta para revisión
humana. Que quepa en ella no significa que mejore a Codex directo. El proveedor
puede comunicar el consumo al cerrar el turno; no se promete un techo exacto de
generación. Todo exceso o consumo desconocido impide aceptar una mejora.

La referencia histórica usó medium y el CLI directo; el candidato usa low y AO.
Por tanto, el ensayo evalúa el circuito completo y es exploratorio. No aísla el
efecto del razonamiento, motor, contexto o caché, ni demuestra ahorro general.
Para aceptar el caso deben pasar la aceptación independiente, las pruebas públicas,
el alcance de archivos y los límites de tiempo/tokens.

La preparación rechazó el código inicial y aceptó la referencia local (36 pruebas),
comprobó el hash de los archivos frente al directo y generó solo una plantilla de
autorización con `approved:false`. La ejecución exige aprobación vigente del plan
y de sus límites exactos; cada turno mantiene la comprobación oficial de ChatGPT
y ausencia de créditos adicionales. Un registro de intento ya creado no puede
reiniciarse preparando de nuevo.

Comandos reproducibles:

```text
node scripts/chief-decision-validation.mjs
node scripts/verify-adaptive.mjs validacion-jefe
node scripts/chief-pilot.mjs prepare
```

Estos comandos son locales y no ejecutan inferencia. La acción `execute` del
piloto es distinta y no se ha usado. Los registros privados y los artefactos
temporales permanecen fuera de Git. No se modificaron los gráficos, los informes
históricos, el motor predeterminado ni los límites habituales de la oficina.
