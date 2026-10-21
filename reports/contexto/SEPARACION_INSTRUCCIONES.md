# Separación de instrucciones de Codex por proyecto

Se aplicó la separación solicitada el 21 de octubre de 2026. El archivo global
contiene exclusivamente las preferencias generales mostradas previamente al
usuario: español, autonomía, commits y ramas locales dentro del encargo,
validación, honestidad, protección del trabajo ajeno y de credenciales.

## Distribución aplicada

- Global de Codex: 1.952 caracteres; antes tenía 13.373. Estas longitudes no son
  tokens ni una medición del ahorro de cuota.
- AjudesClares: se conservó su mapa AGENTS.md existente, se añadió una referencia
  obligatoria a `docs/sistema_ingenieria/CONTRIBUCION_MIGRADA_CODEX.md` y se
  actualizó su regla de Git según la autorización del usuario. El documento
  conserva las reglas específicas del antiguo global, salvo esa actualización
  de Git. La política general de autonomía se sustituyó por las preferencias
  globales nuevas; el original completo está respaldado.
- Espacio de trabajo de la oficina: AGENTS.md breve que dirige al repositorio.
- Repositorio Pixel Office: [AGENTS.md](../../AGENTS.md) con decisiones creativas,
  restricciones de suscripción, mapa, privacidad y comandos propios.

Las copias originales de los dos archivos modificados se guardaron bajo
`instruction-backups/` en el hogar de Codex, en una subcarpeta con fecha y hora.
Se verificaron sus hashes SHA-256. La ubicación exacta queda sólo en el registro
local ignorado por Git `.local-office/instruction-migration/state.json`.
No se modificaron autenticación, modelos, cuotas, configuración de proveedores
ni datos operativos. No se hicieron commits, push ni cambios de rama.

## Verificación realizada

Se utilizó `codex debug prompt-input`, que renderiza el contexto local sin
ejecutar una tarea de IA. No se guardaron los prompts del diagnóstico: sólo los
indicadores y resultados de [separacion-instrucciones.json](separacion-instrucciones.json).

| Carpeta de diagnóstico           | Preferencias globales | Guía propia                                | AjudesClares fuera de su proyecto |
| -------------------------------- | --------------------- | ------------------------------------------ | --------------------------------- |
| Temporal neutral                 | Sí                    | Ninguna                                    | Ausente                           |
| Espacio de trabajo de la oficina | Sí                    | Mapa de la oficina                         | Ausente                           |
| Repositorio Pixel Office         | Sí                    | Guía de Pixel Office                       | Ausente                           |
| Proyecto AjudesClares            | Sí                    | Guía de AjudesClares y enlace a sus reglas | No aplica                         |

Los cuatro diagnósticos y la conservación de reglas y backups superaron sus
aserciones. Cero llamadas a modelos durante esta migración. Las cuatro pruebas
del analizador de contexto siguen pasando. No se ejecutaron suites de aplicación:
el cambio sólo afecta documentación e instrucciones, sin modificar código.

Codex carga instrucciones globales y de proyecto de forma acumulativa, según
su [documentación oficial](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
Para obtener un contexto nuevo conviene abrir una conversación nueva en la
carpeta correspondiente. El historial ya enviado no se borra con esta migración.
La comparación de consumo real de las variantes del estudio sigue pendiente.
