# `memetize_worker`

The Node <-> Python protocol (spec sections 9, 10), shared by `scene-detector`,
`transcript` and `audio-analyzer`.

It is not a published package: each worker is a `package = false` uv project with
its own virtualenv, so this directory is put on `PYTHONPATH` instead. The Node
side does it in `runPythonWorker` (`packages/shared/src/python.ts`); pytest does
it through each worker's `[tool.pytest.ini_options] pythonpath`.
