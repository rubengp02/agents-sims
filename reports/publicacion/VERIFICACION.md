# Comprobación previa a publicación

Fecha: 21 de octubre de 2026.

Destino autorizado: https://github.com/rubengp02/agents-sims

Se conserva el historial de origen, las licencias y los cambios locales. Los lanzadores de Windows y la guía se han adaptado a la raíz del repositorio; se incluyen las propuestas históricas. No se cambia el diseño.

Comprobaciones reales locales:

- Tipos, lint y compilación de producción: superados. Persiste el aviso conocido de dependencia de useEffect en App.tsx.
- Interfaz: 59 pruebas superadas. Servidor: 628. Contrato de paquete: 7. Total npm test: 694.
- Contexto, benchmark y política del piloto: 33 pruebas superadas con --test-concurrency=1.
- Intento previo de ejecutar los archivos de benchmark en paralelo: 15 pruebas superadas y un archivo fallido por colisión en el bundle temporal compartido. Se repitió usando la configuración secuencial prevista; 29/29 superadas, y después 33/33 incluyendo contexto.
- Gitleaks 8.30.1: historial y cambios preparados sin secretos detectados. Descarga oficial con SHA-256 comprobado; también se ejecutó el hook de seguridad y formato del repositorio.
- Estado privado, transcripciones, logs, dependencias y compilados excluidos por Git.

Estas comprobaciones no han iniciado inferencia real ni consumido cuota de modelos. No se repite ni se modifica la comparación real previa.

El primer push fue detenido por el hook local: el inventario E2E generado todavía indicaba 77 casos y faltaba el caso nuevo de equipo. Se regeneró a 78 casos y se incorporó al commit; no se omitió el control. El inventario cuenta casos disponibles, no pruebas E2E ejecutadas en esta publicación.
