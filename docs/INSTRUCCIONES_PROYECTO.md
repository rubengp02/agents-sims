# Instrucciones del proyecto y Codex

No hace falta repetir en el formulario lo que ya esté en los `AGENTS.md`.
**Instrucciones adicionales**, dentro de **Ajustes avanzados**, es un complemento
opcional, oculto inicialmente. Los valores guardados se conservan aunque no se
despliegue el apartado al guardar. La investigación inicial
puede pedirse como primer mensaje de una conversación.

## Comportamiento comprobado

La ejecución directa utiliza la carpeta seleccionada como `cwd` y `--cd`.
El entorno conserva `CODEX_HOME` y las variables del perfil necesarias; no sustituye
la carpeta de Codex por la de la oficina. `--ignore-user-config` evita cargar
`config.toml`, pero no es una opción para desactivar los archivos `AGENTS.md`.
No se utiliza `--ignore-rules`.

Codex carga la guía global y las guías aplicables desde la raíz del repositorio
hasta la carpeta de ejecución. `AGENTS.override.md` tiene prioridad sobre
`AGENTS.md`. Una guía de un proyecto ajeno situado por encima de la raíz Git no
se hereda. Los archivos en subcarpetas siguen teniendo su propio alcance: no se
inyecta indiscriminadamente toda la documentación del repositorio.

Un archivo llamado `codex.md` no se considera automáticamente equivalente. La
oficina no configura ese nombre como alternativa ni recupera ajustes arbitrarios
de usuario que pudieran alterar proveedor, permisos o cuota.

En AO, Git conserva las guías versionadas en las copias aisladas. Las guías locales
ignoradas por Git pueden quedar fuera. El ejecutor compara las guías aplicables
del proyecto original con las disponibles en la copia y añade únicamente el texto
que falta al encargo. Conserva el orden raíz→subcarpeta, registra su tamaño real y
no guarda ese texto en los registros de ejecución. No modifica archivos AGENTS.
La información adicional debe caber en el límite de contexto existente: no se
aumentan presupuestos. Si una guía que debe trasladarse no es un archivo local
regular, supera 32 KiB o el conjunto supera ese tamaño, se pide revisión mediante
un bloqueo claro; no se recortan reglas en silencio.

## Verificación sin inferencia

```powershell
npm run verify:instructions
```

Usa `codex debug prompt-input`, el CLI instalado, una carpeta de Codex temporal y
repositorios Git temporales con instrucciones sintéticas. Comprueba guías globales,
raíz, subcarpeta, overrides, exclusión de proyectos ajenos y traslado de una guía
ignorada a una copia Git. Solo imprime resultados, sin contenido de instrucciones
personales, credenciales ni transcripciones. No envía turnos ni consume cuota.
Puede pasarse la ruta del ejecutable como argumento si no está en PATH.

Las pruebas de servidor verifican además el turno de AO con un proceso simulado,
la ausencia de duplicados y la privacidad del registro. Estas comprobaciones
demuestran qué recibe el ejecutor; no garantizan que un modelo obedezca siempre
todas las reglas ni sustituyen la revisión del resultado.

Referencia: [documentación oficial de instrucciones de Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

## Resultado de esta entrega

- Inspección offline con el CLI real: aprobada, usando guías sintéticas.
- Tipos, lint y compilación: aprobados. Sigue el aviso previo de `App.tsx` sobre
  una dependencia de `useEffect`.
- Pruebas dirigidas de instrucciones y ejecutores: aprobadas, incluido el envío
  al turno aislado y la ausencia de texto de instrucciones en su registro.
- Interfaz: 59 pruebas aprobadas. Contrato de paquete y estudio de privacidad:
  11 pruebas aprobadas.
- Servidor: 47 archivos de pruebas pasan con su límite habitual. El archivo
  `parallelWorkflow.test.ts` excede los 10 segundos en varias pruebas. Sus 19
  pruebas pasan al ejecutarlo por separado con `--testTimeout=30000`; varias
  necesitan 16–17 segundos. No se ha modificado la configuración permanente de
  pruebas ni ningún límite de ejecución de encargos.
- Oficina recompilada y reiniciada sin encargos activos. No hubo inferencia real.
