# AI Meme Video Editor

## Especificação Técnica — MVP Local

**Status:** Ready for implementation
**Plataforma inicial:** macOS / Apple Silicon M4
**Objetivo:** geração automática de vídeos verticais para TikTok/Reels a partir de música + catálogo de vídeos/memes.

---

# 1. Visão geral

O projeto implementará um motor de edição de vídeo assistido por IA capaz de:

1. receber e catalogar vídeos/memes;
2. decompor os vídeos em cenas e momentos semanticamente relevantes;
3. indexar esses momentos para busca semântica;
4. receber uma música;
5. analisar ritmo, estrutura, letra e narrativa;
6. selecionar os memes mais adequados para cada trecho;
7. determinar os pontos exatos de entrada e saída;
8. produzir uma timeline estruturada;
9. renderizar o vídeo automaticamente;
10. gerar um MP4 vertical pronto para revisão/publicação.

O princípio arquitetural principal será:

> A IA decide a edição. O renderer somente executa a timeline.

A IA nunca produzirá diretamente o vídeo final.

O principal artefato do sistema será uma timeline determinística em JSON.

```text
Música
  ↓
Análise musical
  ↓
Análise narrativa
  ↓
Busca de memes
  ↓
Ranking
  ↓
Direção editorial
  ↓
Timing
  ↓
timeline.json
  ↓
FFmpeg
  ↓
output.mp4
```

---

# 2. Escopo do MVP

O MVP será executado inteiramente no MacBook Air M4.

Não haverá inicialmente:

* AWS;
* SQS;
* ECS;
* Lambda;
* Step Functions;
* Redis;
* Kafka;
* Kubernetes;
* arquitetura distribuída.

Os workers serão componentes lógicos independentes, mas executados como processos locais.

A aplicação deverá ser desenhada de maneira que esses workers possam posteriormente migrar para infraestrutura distribuída sem reescrever a lógica de negócio.

---

# 3. Stack

## Runtime principal

```text
Node.js
TypeScript
pnpm
Turborepo
```

## Backend

```text
Fastify
Drizzle ORM
typedi
Zod
```

O Fastify será introduzido após o pipeline funcionar pela CLI.

## Python

```text
Python 3.x
uv
pytest
```

Python será utilizado principalmente para:

```text
computer vision
audio processing
ML inference
scene detection
transcription
embeddings
```

## Banco

```text
PostgreSQL
pgvector
```

## Multimedia

```text
FFmpeg
ffprobe
PySceneDetect
OpenCV
```

## IA local

Preferencialmente:

```text
MLX
Metal
Apple Silicon
```

Provedores deverão ser abstraídos para permitir substituir modelos locais por APIs futuramente.

---

# 4. Princípios arquiteturais

## 4.1 Separação lógica

Cada worker executará uma única responsabilidade.

Exemplo:

```text
Scene Detector

não:
- transcreve
- cria embedding
- interpreta meme
- renderiza
```

Isso permite alterar uma parte do pipeline sem reprocessar todo o catálogo.

---

## 4.2 Idempotência

Todos os workers devem ser idempotentes.

A execução:

```text
VISION_ANALYSIS
scene=scn_123
worker=v2
inputHash=abc
```

deve produzir somente um resultado persistente.

Uma segunda execução com os mesmos parâmetros deve retornar o resultado existente.

Chave lógica:

```text
jobType
+
entityId
+
inputHash
+
workerVersion
```

---

## 4.3 Determinismo

Sempre que possível:

```text
mesma entrada
+
mesma versão
=
mesmo resultado
```

Especialmente para:

```text
normalização
scene detection
ranking
timing
renderização
```

Workers generativos devem armazenar:

```text
modelo
versão
prompt
temperatura/configuração
input
output
```

---

## 4.4 Milissegundos como unidade padrão

Tempo nunca será armazenado como floating point.

Errado:

```json
{
  "start": 3.333333
}
```

Correto:

```json
{
  "startMs": 3333
}
```

Toda a aplicação trabalhará internamente com inteiros em milissegundos.

---

# 5. Estrutura do monorepo

```text
ai-meme-video-editor/
│
├── apps/
│   ├── cli/
│   │   └── src/
│   │
│   ├── api/
│   │   └── src/
│   │
│   └── web/
│       └── src/
│
├── workers/
│   ├── video-normalizer/
│   ├── scene-detector/
│   ├── transcript/
│   ├── frame-extractor/
│   ├── vision-analyzer/
│   ├── moment-extractor/
│   ├── embedding/
│   ├── audio-analyzer/
│   └── renderer/
│
├── packages/
│   ├── database/
│   ├── contracts/
│   ├── job-system/
│   ├── orchestrator/
│   ├── media-catalog/
│   ├── model-providers/
│   ├── candidate-retriever/
│   ├── clip-ranker/
│   ├── narrative-analyzer/
│   ├── director/
│   ├── timing/
│   ├── effects/
│   ├── timeline/
│   └── shared/
│
├── storage/
│   ├── assets/
│   ├── audio/
│   ├── frames/
│   ├── cache/
│   ├── timelines/
│   ├── renders/
│   └── temp/
│
├── fixtures/
│   ├── videos/
│   ├── audio/
│   └── timelines/
│
├── scripts/
│
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

# 6. Arquitetura de execução

Inicialmente:

```text
CLI
 │
 ▼
Orchestrator
 │
 ▼
PostgreSQL Job Queue
 │
 ├── TypeScript workers
 │
 └── Python workers
```

Posteriormente:

```text
Next.js
   ↓
Fastify
   ↓
mesmo Orchestrator
```

A interface HTTP não deverá conter lógica de processamento.

---

# 7. Job System

## Tabela `jobs`

Campos:

```text
id
type
entity_id
status
payload
result
priority
resource_class

attempts
max_attempts

input_hash
worker_version

created_at
started_at
completed_at

error_code
error_message
```

Estados:

```text
PENDING
RUNNING
COMPLETED
FAILED
CANCELLED
```

---

## Claim de job

O orchestrator deverá utilizar locking no PostgreSQL.

Conceitualmente:

```sql
SELECT *
FROM jobs
WHERE status = 'PENDING'
ORDER BY priority DESC, created_at
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

Após selecionar:

```text
PENDING
↓
RUNNING
```

---

# 8. Resource Scheduler

O MacBook Air não deverá executar múltiplas tarefas pesadas simultaneamente.

Categorias:

```typescript
type ResourceClass =
  | "CPU_LIGHT"
  | "CPU_HEAVY"
  | "GPU"
  | "IO"
  | "RENDER";
```

Configuração inicial recomendada:

```text
CPU_LIGHT = 4
CPU_HEAVY = 1
GPU = 1
IO = 4
RENDER = 1
```

Exemplos:

```text
scene-detector
→ CPU_LIGHT

video-normalizer
→ CPU_HEAVY

vision-analyzer
→ GPU

transcript
→ GPU

embedding
→ GPU

renderer
→ RENDER
```

Somente um workload pesado relacionado a GPU deverá executar inicialmente por vez.

---

# 9. Contrato universal de worker

Workers TypeScript e Python deverão seguir o mesmo protocolo.

## Request

```json
{
  "jobId": "job_123",
  "entityId": "ast_456",
  "workerVersion": "1.0.0",
  "input": {}
}
```

## Success

```json
{
  "jobId": "job_123",
  "status": "success",
  "output": {},
  "metadata": {
    "processingTimeMs": 4212,
    "workerVersion": "1.0.0"
  }
}
```

## Failure

```json
{
  "jobId": "job_123",
  "status": "failed",
  "error": {
    "code": "VIDEO_DECODE_ERROR",
    "message": "Unable to decode input media",
    "retryable": false
  }
}
```

---

# 10. Node ↔ Python

Não haverá HTTP entre workers locais.

O orchestrator Node deverá executar Python através de subprocessos.

```text
Node
 ↓
spawn
 ↓
Python
```

Preferencialmente:

```bash
uv run python -m workers.scene_detector
```

O request será enviado via `stdin`.

O único conteúdo enviado para `stdout` será a resposta JSON final.

Logs serão enviados para:

```text
stderr
```

Isso evita quebrar o parser do protocolo.

Exit code:

```text
0 = sucesso
!= 0 = falha
```

---

# 11. Storage local

Estrutura:

```text
storage/

assets/
  ast_123/
    original.mp4
    proxy.mp4
    analysis.mp4
    thumbnail.jpg

frames/
  ast_123/
    scn_001/
      frame_000000.jpg
      frame_001500.jpg
      frame_003000.jpg

audio/

cache/

timelines/
  prj_123/
    v1.json
    v2.json

renders/
  prj_123/
    render_001.mp4

temp/
```

O PostgreSQL será a fonte oficial de metadados.

Filesystem será responsável pelos blobs.

---

# 12. Pipeline de catalogação

```text
Vídeo
 ↓
Asset Ingestor
 ↓
Video Normalizer
 ↓
Scene Detector
 ↓
 ├──────────────┐
 ↓              ↓
Transcript    Frame Extractor
 │              │
 └───────┬──────┘
         ↓
Vision Analyzer
         ↓
Moment Extractor
         ↓
Embedding Worker
         ↓
READY
```

---

# 13. Asset Ingestor

Responsabilidades:

```text
validar arquivo
calcular checksum
detectar duplicação
registrar asset
copiar original
executar ffprobe
criar job de normalização
```

Checksum:

```text
SHA-256
```

Se o checksum já existir:

```text
não duplicar asset
```

---

# 14. `media_assets`

Schema conceitual:

```text
id
filename

original_path
proxy_path
analysis_path

checksum

duration_ms
width
height
fps

content_type
size_bytes

status

rights_status
source
copyright_owner

created_at
updated_at
```

Status:

```text
INGESTED
PROCESSING
READY
FAILED
```

---

# 15. Video Normalizer Worker

Objetivo:

transformar arquivos heterogêneos em formatos internos previsíveis.

Entrada pode conter:

```text
MP4
MOV
WebM
MKV
AVI
24fps
30fps
60fps
4K
480p
```

Saídas:

### Original

Arquivo inalterado.

### Proxy

Uso em preview futuro.

Exemplo:

```text
H.264
720p
30fps
```

### Analysis

Uso nos modelos.

Exemplo:

```text
480p
15fps
```

FFmpeg será responsável pela conversão.

---

# 16. Scene Detector Worker

Responsabilidade:

detectar cortes editoriais.

Output:

```json
{
  "assetId": "ast_123",
  "scenes": [
    {
      "id": "scn_001",
      "startMs": 0,
      "endMs": 3240
    },
    {
      "id": "scn_002",
      "startMs": 3240,
      "endMs": 8120
    }
  ]
}
```

Tabela:

```text
scenes

id
asset_id

start_ms
end_ms
duration_ms

detector
detector_version

created_at
```

---

# 17. Transcript Worker

Responsabilidades:

```text
extrair áudio
transcrever
alinhar timestamps
produzir timestamps de segmentos
produzir timestamps de palavras quando disponível
```

Modelo inicialmente deverá rodar localmente e aproveitar Apple Silicon.

Contrato:

```json
{
  "segments": [
    {
      "startMs": 1200,
      "endMs": 3800,
      "text": "No, God, please no!",
      "words": [
        {
          "text": "No",
          "startMs": 1200,
          "endMs": 1450
        }
      ]
    }
  ]
}
```

---

# 18. Frame Extractor

Não armazenaremos todos os frames.

Por cena, inicialmente:

```text
primeiro
25%
50%
75%
último
```

Para cenas maiores, adicionar amostragem aproximadamente a cada:

```text
500-1000 ms
```

com limite configurável.

Output:

```json
{
  "sceneId": "scn_123",
  "frames": [
    {
      "timestampMs": 0,
      "path": "..."
    }
  ]
}
```

---

# 19. Vision Analyzer

Responsabilidade:

interpretar semanticamente a cena.

Não deve retornar apenas uma descrição visual.

Precisamos de dois níveis:

### Descrição objetiva

```text
o que está acontecendo?
```

### Interpretação editorial

```text
como esse trecho poderia ser utilizado como meme?
```

Contrato:

```json
{
  "sceneId": "scn_123",

  "summary": "Homem olha ao redor demonstrando confusão.",

  "subjects": [
    {
      "type": "person",
      "description": "adult male"
    }
  ],

  "actions": [
    "looking around",
    "searching"
  ],

  "emotionTrajectory": [
    {
      "time": 0,
      "emotion": "neutral",
      "intensity": 0.2
    },
    {
      "time": 1,
      "emotion": "confusion",
      "intensity": 0.8
    }
  ],

  "visualEnergy": 0.24,

  "camera": {
    "movement": "static",
    "shotType": "medium"
  },

  "memeFunctions": [
    "confusion",
    "searching",
    "unexpected_situation"
  ],

  "quality": {
    "usable": true,
    "score": 0.91
  }
}
```

O output deverá obrigatoriamente respeitar schema estruturado.

---

# 20. Model Provider abstraction

Nenhum worker deverá depender diretamente de um modelo específico.

Interfaces:

```typescript
interface VisionProvider {
  analyze(input: VisionInput): Promise<VisionResult>;
}
```

```typescript
interface TranscriptionProvider {
  transcribe(input: AudioInput): Promise<Transcript>;
}
```

```typescript
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}
```

```typescript
interface LLMProvider {
  generateStructured<T>(
    request: StructuredGenerationRequest<T>
  ): Promise<T>;
}
```

Isso permitirá:

```text
local MLX
→ API externa
→ outro modelo
```

sem alterar a lógica de negócio.

---

# 21. Moment Extractor

`scene` representa estrutura cinematográfica.

`moment` representa unidade editorial.

Exemplo:

```text
Scene de 7 segundos

0-2s
pessoa séria

2-3.5s
percebe algo

3.5-6s
começa a rir

6-7s
gargalhada
```

Moments:

```text
moment 1
serious setup

moment 2
realization

moment 3
trying not to laugh

moment 4
laughing
```

Schema:

```text
moments

id
scene_id
asset_id

start_ms
end_ms
duration_ms

description

primary_emotion
emotion_intensity
visual_energy

quality_score

created_at
```

Metadata adicional poderá permanecer em JSONB.

---

# 22. Moment Extractor V1

No MVP o VLM poderá sugerir os intervalos aproximados.

Posteriormente:

```text
VLM suggestion
+
motion analysis
+
facial changes
+
optical flow
```

poderão refinar os boundaries.

O MVP não deve bloquear esperando uma detecção perfeita.

---

# 23. Embedding Worker

Cada moment terá mais de uma representação textual.

Exemplo:

```text
visualDescription:
"man looking around"

memeInterpretation:
"confused reaction when nobody knows what is happening"

narrativeFunction:
"reaction after unexpected situation"
```

Tipos:

```text
VISUAL
MEME
NARRATIVE
```

Tabela:

```text
moment_embeddings

id
moment_id

embedding_type

embedding vector

model
model_version

created_at
```

O embedding mais importante para retrieval será inicialmente:

```text
MEME
```

---

# 24. Pipeline de geração

```text
song.mp3
   ↓
Audio Analyzer
   +
Lyrics Worker
   ↓
Narrative Analyzer
   ↓
Candidate Retriever
   ↓
Clip Ranker
   ↓
Timeline Director
   ↓
Timing Optimizer
   ↓
Effects Planner
   ↓
timeline.json
   ↓
Renderer
   ↓
Validator
   ↓
MP4
```

---

# 25. Audio Analyzer

Não utilizar LLM.

Responsabilidades:

```text
duration
BPM
beats
downbeats
onsets
loudness
energy
silence
sections
```

Contrato:

```json
{
  "durationMs": 32000,

  "tempo": {
    "bpm": 128
  },

  "beats": [
    {
      "timeMs": 120,
      "strength": 0.81
    }
  ],

  "downbeats": [
    120,
    1996,
    3872
  ],

  "sections": [
    {
      "type": "intro",
      "startMs": 0,
      "endMs": 7400
    }
  ],

  "energyCurve": [
    {
      "timeMs": 1000,
      "value": 0.22
    }
  ]
}
```

---

# 26. Lyrics

Podem vir:

```text
do usuário
```

ou:

```text
da transcrição
```

Precisamos de alinhamento temporal.

```json
{
  "startMs": 10300,
  "endMs": 13700,

  "text": "I thought everything was fine",

  "words": []
}
```

---

# 27. Narrative Analyzer

Responsabilidade:

transformar letra + características musicais em uma especificação editorial.

Entrada:

```text
lyrics
musical sections
energy
beats
```

Output:

```json
{
  "segments": [
    {
      "id": "seg_001",

      "startMs": 10300,
      "endMs": 13700,

      "lyrics": "I thought everything was fine",

      "meaning": "someone believes situation is under control",

      "emotion": "confidence",

      "narrativeFunction": "setup",

      "visualIdeas": [
        "false confidence",
        "celebrating too early",
        "overconfident reaction"
      ],

      "literalness": 0.3,
      "ironyPotential": 0.89,

      "energy": 0.42
    }
  ]
}
```

---

# 28. Candidate Retriever

Não utilizar LLM para selecionar diretamente todos os vídeos.

O Narrative Analyzer gera queries.

Exemplo:

```text
false confidence
celebrating too early
overconfident reaction
```

O Retriever executa busca no pgvector.

Exemplo conceitual:

```sql
SELECT
  moment_id,
  embedding <=> :query AS distance
FROM moment_embeddings
WHERE embedding_type = 'MEME'
ORDER BY distance
LIMIT 50;
```

Output:

```json
{
  "segmentId": "seg_001",

  "candidates": [
    {
      "momentId": "mom_812",
      "semanticScore": 0.94
    }
  ]
}
```

Inicialmente:

```text
20-50 candidatos/segmento
```

---

# 29. Clip Ranker

O Retriever encontra candidatos semanticamente próximos.

O Ranker determina quais candidatos são realmente bons para edição.

Score inicial:

```text
semantic        35%
emotion         15%
narrative       15%
duration        10%
energy          10%
quality          5%
novelty          5%
usage            5%
```

Conceitualmente:

```typescript
score =
    semanticScore * 0.35
  + emotionScore * 0.15
  + narrativeScore * 0.15
  + durationScore * 0.10
  + energyScore * 0.10
  + qualityScore * 0.05
  + noveltyScore * 0.05
  + usageScore * 0.05;
```

---

# 30. Diversity Engine

Penalidades:

```text
same_asset_penalty
same_character_penalty
recent_usage_penalty
same_category_penalty
consecutive_reaction_penalty
```

Regras iniciais:

```text
não repetir mesmo asset no mesmo vídeo

evitar mesmo personagem consecutivamente

penalizar assets usados recentemente

evitar sequência visual excessivamente semelhante
```

Tabela futura:

```text
moment_usage

moment_id
project_id
used_at
```

---

# 31. Timeline Director

O Director recebe apenas os melhores candidatos.

Exemplo:

```text
Segment 1

A score .92
B score .90
C score .88

Segment 2

D score .94
E score .91
F score .90
```

Ele decidirá a composição global.

Responsabilidades:

```text
variedade
narrativa
setup
punchline
ritmo
energia visual
continuidade
```

O Director não deverá acessar diretamente todo o catálogo.

---

# 32. Timing Optimizer

Separado do Director.

Director:

```text
qual clip usar?
```

Timing:

```text
quando exatamente ele começa e termina?
```

Deve considerar:

```text
beats
downbeats
audio onset
visual reaction point
punchline
duration
```

Objetivo:

alinhar eventos visuais importantes a eventos musicais.

Exemplo:

```text
visual punchline
        ↓
musical downbeat
```

---

# 33. Effects Planner

Responsável por decidir efeitos simples.

Inicialmente:

```text
zoom
hard cut
fade
speed
crop
position
```

Regras possíveis:

```text
punchline
→ zoom

drop
→ hard cut

low energy
→ shot mais longo

high energy
→ cortes mais curtos
```

Nada disso deverá ser decidido pelo FFmpeg.

---

# 34. Timeline Schema

Esse será um dos contratos centrais do sistema.

```json
{
  "schemaVersion": "1.0",

  "projectId": "prj_123",

  "canvas": {
    "width": 1080,
    "height": 1920,
    "fps": 30
  },

  "durationMs": 32000,

  "audio": {
    "path": "storage/audio/song.mp3",
    "timelineStartMs": 0,
    "sourceStartMs": 0,
    "volume": 1
  },

  "clips": [
    {
      "id": "clip_001",

      "momentId": "mom_123",

      "timeline": {
        "startMs": 0,
        "endMs": 1850
      },

      "source": {
        "assetId": "ast_123",
        "startMs": 4210,
        "endMs": 6060
      },

      "transform": {
        "scale": 1.2,
        "positionX": 0.5,
        "positionY": 0.5,
        "cropMode": "cover"
      },

      "effects": [
        {
          "type": "zoom",
          "startMs": 1200,
          "endMs": 1850,
          "from": 1,
          "to": 1.12
        }
      ],

      "reason": {
        "segmentId": "seg_001",
        "semanticScore": 0.94,
        "finalScore": 0.88
      }
    }
  ]
}
```

O schema oficial ficará em:

```text
packages/timeline
```

Zod será a fonte TypeScript do contrato.

Também deverá existir JSON Schema exportável para validação externa.

---

# 35. Timeline versioning

Nunca sobrescrever timeline.

```text
timeline v1
timeline v2
timeline v3
```

Tabela:

```text
timeline_versions

id
project_id
version
data
created_at
```

Isso permitirá:

```text
regenerate
compare
rollback
manual edit
```

---

# 36. Renderer

O renderer não deverá usar IA.

Entrada:

```text
timeline.json
```

Saída:

```text
MP4
```

Pipeline:

```text
resolve assets
↓
validate timeline
↓
build FFmpeg graph
↓
render
↓
ffprobe validation
```

Target inicial:

```text
1080x1920
30fps
H.264
AAC
MP4
```

---

# 37. Renderer determinístico

A seguinte condição deverá ser verdadeira:

```text
timeline v17
+
mesmos assets
+
mesma versão renderer
=
mesmo vídeo
```

Isso é importante para:

```text
debug
cache
testes
reprodução
```

---

# 38. Validation Worker

Executado após render.

Validará:

```text
arquivo existe
arquivo abre
duração
codec
fps
resolução
audio
black frames
missing frames
timeline gaps
overlaps inválidos
clips extremamente curtos
```

Warnings editoriais não precisam bloquear o render.

Exemplo:

```json
{
  "valid": true,

  "warnings": [
    {
      "code": "CLIP_TOO_SHORT",
      "clipId": "clip_017",
      "durationMs": 210
    }
  ]
}
```

---

# 39. Banco de dados inicial

Tabelas:

```text
media_assets
scenes
transcript_segments
moments
moment_embeddings

jobs

projects
project_audio
audio_analysis
lyrics
narrative_segments

timeline_versions
renders
moment_usage
```

Não criar tabelas excessivamente específicas no início.

Metadata volátil poderá permanecer em:

```text
JSONB
```

---

# 40. Estado de um asset

```text
INGESTED

↓

NORMALIZING

↓

ANALYZING

↓

INDEXING

↓

READY
```

Falha:

```text
FAILED
```

O asset poderá ficar `READY` apenas quando possuir pelo menos:

```text
scene
moment
embedding
```

---

# 41. Estado de um projeto

```text
CREATED

↓

ANALYZING_AUDIO

↓

PLANNING

↓

TIMELINE_READY

↓

RENDERING

↓

COMPLETED
```

Falha:

```text
FAILED
```

---

# 42. CLI

A CLI deverá ser a primeira interface oficial.

## Asset

```bash
pnpm cli asset add ./videos/meme.mp4
```

```bash
pnpm cli asset list
```

```bash
pnpm cli asset inspect ast_123
```

```bash
pnpm cli asset reprocess ast_123 --from vision
```

---

## Search

Essa funcionalidade deve existir antes da geração automática.

```bash
pnpm cli search "confused person realizing something went wrong"
```

Resultado esperado:

```text
1. mom_123   score=.94
2. mom_922   score=.91
3. mom_321   score=.88
```

Essa será uma ferramenta fundamental para validar a qualidade do catálogo.

---

## Generate

```bash
pnpm cli project create ./music/song.mp3
```

```bash
pnpm cli project generate prj_123
```

```bash
pnpm cli project render prj_123
```

Ou shorthand:

```bash
pnpm cli generate ./music/song.mp3
```

---

# 43. Observabilidade

Logs estruturados.

TypeScript:

```text
JSON logs
```

Python:

```text
JSON/structured logs
```

Todo log deverá incluir:

```text
jobId
worker
workerVersion
entityId
```

Exemplo:

```json
{
  "level": "info",
  "jobId": "job_123",
  "worker": "scene-detector",
  "entityId": "ast_456",
  "event": "scene_detection_completed",
  "sceneCount": 12
}
```

---

# 44. Métricas locais

Registrar no banco inicialmente:

```text
processing_time_ms
model_inference_time_ms
frames_processed
memory-related failures
number_of_scenes
number_of_moments
candidate_count
render_time_ms
```

Isso permitirá descobrir o gargalo antes de pensar em cloud.

---

# 45. Versionamento dos workers

Todo resultado produzido por IA deverá conter:

```json
{
  "generatedBy": {
    "worker": "vision-analyzer",
    "workerVersion": "1.3.0",
    "model": "model-name",
    "modelVersion": "version",
    "promptVersion": "vision-v4"
  }
}
```

Esse metadata é obrigatório.

---

# 46. Prompt versioning

Prompts serão tratados como código.

```text
packages/
  prompts/
    vision/
      v1.txt
      v2.txt

    narrative/
      v1.txt

    director/
      v1.txt
```

Ou equivalente estruturado.

Nunca alterar silenciosamente um prompt existente.

Nova mudança:

```text
v3
→
v4
```

---

# 47. Cache

Resultados caros devem ser armazenados.

Chave conceitual:

```text
inputHash
+
processorVersion
+
modelVersion
+
promptVersion
```

Cache inicialmente pode usar:

```text
PostgreSQL
+
filesystem
```

Não precisamos Redis.

---

# 48. Estratégia de desenvolvimento

A implementação será incremental.

## Fase 0 — Foundation

Criar:

```text
monorepo
pnpm
Turborepo
TypeScript config
Python + uv
PostgreSQL
pgvector
Drizzle
Zod
Vitest
pytest
```

Resultado:

```text
pnpm test
pnpm lint
pnpm typecheck
```

funcionando.

---

# 49. Fase 1 — Media foundation

Implementar:

```text
Asset Ingestor
ffprobe
checksum
filesystem
Video Normalizer
Scene Detector
```

Critério:

Dado um vídeo, obter:

```text
asset
proxy
analysis video
scene list
```

---

# 50. Fase 2 — Semantic catalog

Implementar:

```text
Frame Extractor
Transcript Worker
Vision Analyzer
Moment Extractor
```

Critério:

Dado um meme, gerar algo semelhante a:

```text
scene 1

moment 1:
"confused reaction"

moment 2:
"realization"

moment 3:
"panic"
```

---

# 51. Fase 3 — Semantic search

Implementar:

```text
Embedding Worker
pgvector
Candidate Retriever
CLI search
```

Esta é a primeira grande prova de conceito.

Teste:

```bash
pnpm cli search \
  "person realizing something terrible happened"
```

O sistema deve retornar clips semanticamente coerentes.

Não seguir para geração automática antes disso funcionar satisfatoriamente.

---

# 52. Fase 4 — Audio intelligence

Implementar:

```text
Audio Analyzer
Lyrics
Lyrics alignment
Narrative Analyzer
```

Critério:

Uma música deve virar:

```text
musical timeline
+
semantic timeline
```

---

# 53. Fase 5 — Matching

Implementar:

```text
Candidate Retriever
Clip Ranker
Diversity Engine
```

Para cada trecho musical:

```text
segment
↓
50 candidates
↓
10 candidates
↓
3 candidates
```

---

# 54. Fase 6 — Director

Implementar:

```text
Timeline Director
```

Receber top candidates e gerar a primeira:

```text
timeline.json
```

Ainda sem efeitos avançados.

---

# 55. Fase 7 — Renderer

Implementar:

```text
Timeline validator
FFmpeg builder
Renderer
Output validator
```

Resultado:

```text
music.mp3
+
catalog
=
1080x1920.mp4
```

Essa etapa representa o primeiro MVP completo.

---

# 56. Fase 8 — Timing

Somente após vídeos end-to-end funcionarem:

```text
beat alignment
downbeat alignment
reaction alignment
cut refinement
```

Antes disso, sincronização precisa não deve bloquear o MVP.

---

# 57. Fase 9 — Effects

Adicionar:

```text
zoom
crop
speed
freeze
fade
```

Não adicionar biblioteca enorme de transições.

Para vídeos de meme:

```text
hard cuts
timing
zoom
```

provavelmente serão mais importantes.

---

# 58. Fase 10 — UI

Somente depois do motor funcionar.

Criar:

```text
Next.js Studio
```

Views principais:

```text
Media Library

Project

Timeline

Preview

Candidate alternatives

Render
```

Funcionalidades:

```text
trocar clip
lock clip
regenerate segment
regenerate timeline
adjust trim
render
```

---

# 59. Testes

## TypeScript

```text
Vitest
```

## Python

```text
pytest
```

---

# 60. Unit tests

Cobrir principalmente:

```text
ranking
timing
diversity penalties
timeline validation
job state transitions
idempotency
filesystem paths
```

---

# 61. Contract tests

Todo worker terá fixtures.

Exemplo:

```text
fixtures/videos/test-meme.mp4
```

Teste:

```text
scene detector
```

deve sempre gerar aproximadamente o mesmo conjunto de cenas.

---

# 62. Golden tests

Manter pequenas timelines conhecidas.

```text
fixtures/timelines/golden-001.json
```

Renderizar e verificar:

```text
duration
resolution
audio
clip count
```

Não é necessário verificar pixel-a-pixel inicialmente.

---

# 63. Teste end-to-end

Fixture:

```text
10 segundos de música

5-10 memes
```

Pipeline:

```text
catalog
→
index
→
audio analysis
→
planning
→
timeline
→
render
```

Esse teste deverá rodar localmente.

---

# 64. Debugging de IA

Nunca armazenar apenas o resultado final.

Para Vision:

```text
frames usados
prompt
modelo
raw response
parsed response
```

Para Director:

```text
segment
candidates
scores
prompt
selection
reason
```

Isso será fundamental para melhorar a qualidade editorial.

---

# 65. Configuração

`.env` inicial:

```text
DATABASE_URL=

STORAGE_PATH=

MAX_CPU_LIGHT_WORKERS=4
MAX_CPU_HEAVY_WORKERS=1
MAX_GPU_WORKERS=1
MAX_RENDER_WORKERS=1

VISION_PROVIDER=
VISION_MODEL=

TRANSCRIPTION_PROVIDER=
TRANSCRIPTION_MODEL=

EMBEDDING_PROVIDER=
EMBEDDING_MODEL=

LLM_PROVIDER=
LLM_MODEL=
```

Não espalhar configuração pelos workers.

---

# 66. Estratégia de modelos

O sistema deverá permitir combinações como:

```text
transcription
→ local

embedding
→ local

vision
→ local

director
→ local
```

ou:

```text
transcription
→ local

embedding
→ local

vision
→ API

director
→ API
```

A arquitetura não deverá assumir que todos os modelos estão na mesma infraestrutura.

---

# 67. Performance no M4

Prioridades:

```text
reduzir resolução antes de inferência
não analisar todos os frames
cache agressivo
um workload GPU pesado por vez
não reprocessar assets
usar proxy/analysis media
batch quando fizer sentido
```

O catálogo será caro para criar, porém barato para consultar.

Essa assimetria é desejável.

---

# 68. Princípio de indexação

Nunca fazer:

```text
nova música
↓
reanalisar 500 vídeos
```

Fazer:

```text
500 vídeos
↓
analisar uma vez
↓
indexar
```

Depois:

```text
nova música
↓
query no catálogo
```

Essa é uma das decisões arquiteturais mais importantes do projeto.

---

# 69. MVP inicial de catálogo

Começar com:

```text
20-50 vídeos
```

O objetivo não é quantidade.

Precisamos descobrir se:

```text
scene detection
+
moment extraction
+
embeddings
```

conseguem recuperar o trecho certo.

Somente depois aumentar para:

```text
100
500
1000+
```

---

# 70. Critério de sucesso do Semantic Retrieval

Fornecer manualmente queries como:

```text
someone confused

someone celebrating too early

panic after realizing a mistake

trying not to laugh

absolute disaster

awkward silence
```

e analisar manualmente Top 5.

Meta inicial:

```text
3 ou mais resultados bons entre os Top 5
```

na maioria das queries de teste.

---

# 71. Critério de sucesso do MVP completo

O MVP estará tecnicamente concluído quando:

```text
1. importar vídeos

2. indexar catálogo

3. pesquisar semanticamente moments

4. importar música

5. analisar música

6. segmentar narrativa

7. selecionar clips automaticamente

8. gerar timeline JSON válida

9. renderizar vídeo vertical

10. repetir o mesmo render de forma determinística
```

A publicação automática para TikTok está fora desse milestone.

---

# 72. Fora do escopo inicial

Não implementar agora:

```text
TikTok API

mobile app

multi-user

authentication complexa

cloud storage

distributed workers

Kubernetes

billing

subscriptions

team collaboration

automatic caption styling avançado

After Effects integration

Premiere integration

OpenTimelineIO
```

Todos podem ser adicionados posteriormente.

---

# 73. Evolução futura

Quando o pipeline local estiver validado:

```text
Local Job Queue
→ SQS

filesystem
→ S3

local renderer
→ ECS/Batch

local workers
→ ECS

orchestrator
→ Step Functions ou serviço próprio

Postgres local
→ RDS PostgreSQL

pgvector
→ RDS pgvector ou mecanismo dedicado
```

Os workers deverão continuar recebendo os mesmos contratos.

---

# 74. Ordem prática para começar a codificar

Primeiro milestone:

```text
monorepo
database
job system
orchestrator
```

Segundo:

```text
asset ingestion
ffprobe
video normalization
```

Terceiro:

```text
scene detector
frame extractor
```

Quarto:

```text
vision analyzer
moment extractor
```

Quinto:

```text
embeddings
semantic search
```

Nesse momento devemos parar e avaliar a qualidade.

Somente então:

```text
audio
narrative
matching
director
renderer
```

---

# 75. Primeira feature vertical completa

A primeira feature realmente funcional deverá ser:

```bash
pnpm cli asset add meme.mp4
```

seguida de:

```bash
pnpm cli search \
  "someone trying not to laugh"
```

Retornando:

```text
moment
asset
start
end
description
score
```

E opcionalmente:

```bash
pnpm cli moment export mom_123
```

gerando:

```text
./storage/temp/mom_123.mp4
```

Isso permitirá avaliar visualmente o retrieval antes de construir todo o restante do produto.

---

# 76. Segunda feature vertical completa

Depois:

```bash
pnpm cli generate song.mp3
```

Internamente:

```text
analyze audio
↓
analyze lyrics
↓
create narrative segments
↓
retrieve candidates
↓
rank
↓
direct
↓
create timeline
↓
render
```

Output:

```text
storage/
  timelines/
    prj_123/
      v1.json

  renders/
    prj_123/
      render_001.mp4
```

---

# 77. Regra central de engenharia

Não otimizar infraestrutura antes de validar qualidade editorial.

A dificuldade principal do produto não será:

```text
processar FFmpeg
```

nem:

```text
escalar filas
```

Será:

```text
entender uma música
↓
entender um catálogo
↓
encontrar o momento certo
↓
criar uma sequência engraçada
↓
cortar exatamente no momento certo
```

Todo o desenho do MVP deve priorizar nossa capacidade de medir e melhorar essas decisões.

---

# 78. Arquitetura final do MVP

```text
                           CLI
                            │
                            ▼
                     Local Orchestrator
                            │
                         PostgreSQL
                            │
            ┌───────────────┴───────────────┐
            │                               │
     CATALOG PIPELINE                GENERATION PIPELINE
            │                               │
            ▼                               ▼

      Asset Ingestor                  Audio Analyzer
            ↓                               │
      Video Normalizer                     ├── Lyrics
            ↓                               │
      Scene Detector                        ▼
       ┌────┴────┐                  Narrative Analyzer
       ↓         ↓                         ↓
 Transcript   Frames                Candidate Retriever
       │         │                         ↓
       └────┬────┘                    Clip Ranker
            ↓                              ↓
     Vision Analyzer                Diversity Engine
            ↓                              ↓
     Moment Extractor              Timeline Director
            ↓                              ↓
     Embedding Worker              Timing Optimizer
            ↓                              ↓
      PostgreSQL                  Effects Planner
       + pgvector                          ↓
                                   timeline.json
                                          ↓
                                      Renderer
                                          ↓
                                      Validator
                                          ↓
                                    output.mp4
```

---

# 79. Decisão arquitetural final

O sistema será inicialmente um **modular monolith com workers locais**.

Não serão microserviços.

Não haverá comunicação HTTP interna.

Não haverá message broker externo.

A separação existirá no código e nos contratos.

A execução permanecerá simples:

```text
TypeScript Orchestrator

     ↓ spawn

TypeScript/Python Workers

     ↓

PostgreSQL + filesystem
```

Essa arquitetura oferece a menor complexidade possível no MacBook Air M4 sem criar dívida estrutural significativa para uma futura migração para infraestrutura distribuída.

---

# 80. Primeiro objetivo técnico

Antes de gerar qualquer TikTok automaticamente, o sistema precisa responder muito bem à seguinte pergunta:

> “Dentro de todos os vídeos que eu tenho, qual trecho de 1-4 segundos representa melhor esta ideia?”

Quando essa resposta estiver boa, teremos construído o núcleo do produto.

Todo o restante — música, timeline, sincronização, efeitos e renderização — será construído sobre esse motor de inteligência de mídia.
