**Memetize — relatório completo de problemas e correções com exemplos de código**

Repositório: [thethiago27/memetize](https://github.com/thethiago27/memetize). Branch: `main`. Revisão fixa: [`a598f1469e9a242b59407ddd0dc30a67643139db`](https://github.com/thethiago27/memetize/commit/a598f1469e9a242b59407ddd0dc30a67643139db), de 05/09/2026, 02:26 UTC. Análise em 05/09/2026.

**Versão ampliada com código.** A branch `main` foi consultada novamente em 05/09/2026 e permanece no commit acima. Este documento reúne 16 achados principais e três problemas menores, com evidência, impacto, correção sugerida, exemplos e critérios de aceite. Os exemplos são propostas de implementação: recortes compatíveis com funções atuais são identificados separadamente de contratos, tabelas e helpers novos. Não foram aplicados ao repositório.

**O projeto tem uma base aproveitável, mas o motor ainda combina componentes de demonstração com defeitos reais de cobertura, efeitos, renderização e recuperação de execução.** Não encontrei fundamento para recomendar uma reescrita completa ou uma migração para serviços distribuídos. As correções prioritárias cabem na arquitetura local existente.

O maior bloqueio funcional é a ausência de interpretação visual e embeddings semânticos reais. Mesmo com o gateway configurado, análise narrativa e extração de momentos continuam simuladas. Separadamente, reproduzi situações nas quais material suficiente é rejeitado, uma aceleração desaparece após recálculos e uma timeline aceita pelo validador falha no FFmpeg.

**Escopo e limites da evidência.** Inventariei a árvore completa da revisão e obtive 466 arquivos textuais, incluindo código, contratos, migrações SQL, manifests, documentação e testes. Examinei os dois pipelines, API, comandos CLI, operações do editor, persistência, recuperação, feedback e validação. Há 20 pacotes em `packages`, 16 workers e 88 arquivos de teste TypeScript. Não identifiquei ciclos entre as dependências declaradas nos manifests.

Executei reproduções isoladas em Node.js 24.19.0 e FFmpeg 6.1.1, em Linux, usando funções do código revisado e mídia sintética. Para carregar os módulos sem instalar o monorepo, usei um resolvedor de imports TypeScript; constantes vieram do próprio código. Na reprodução de cobertura, apenas a geração de IDs de clipe foi substituída por UUIDs, sem alterar o algoritmo. Não executei a aplicação completa, testes com PostgreSQL, chamadas pagas, MLX ou benchmarks no MacBook Air M4. `pnpm exec vitest --version` retornou `Command "vitest" not found`; não há resultado de aprovação da suíte completa.

Os achados abaixo descrevem a revisão consultada. Não afirmam que todos os cenários já ocorreram no ambiente do usuário. **Reproduzido** significa execução isolada nesta revisão; **código** significa consequência identificável no fluxo, com condição de ocorrência explicitada; **lacuna funcional** significa implementação ainda ausente e reconhecida no próprio código.

| ID | Prioridade | Problema | Evidência |
|---|---|---|---|
| F01 | Alta | Visão, embeddings e parte do LLM ainda simulados | Lacuna funcional |
| F02 | Alta | Cobertura informa catálogo insuficiente com material suficiente | Reproduzido |
| F03 | Alta | Recalcular efeitos altera novamente clipes acelerados | Reproduzido |
| F04 | Alta | Corte seco seguido de crossfade produz grafo incompatível | Reproduzido com FFmpeg |
| F05 | Média | Planejamento não reserva o início necessário às transições | Código e reprodução |
| F06 | Média | Exportação final usa proxy de prévia como primeira opção | Código |
| F07 | Alta | Validação aceita discrepâncias arbitrárias de duração | Reproduzido |
| F08 | Alta | Interrupções deixam jobs sem recuperação e estados incoerentes | Código |
| F09 | Alta | Reprocessamento e versionamento não protegem execução concorrente | Código; depende de concorrência |
| F10 | Média | Barreiras podem perder a continuação do pipeline | Código; depende de concorrência |
| F11 | Alta | Etapas leem dados “mais recentes” sem fixar sua origem | Código |
| F12 | Alta | Reprocessamento rompe a identidade usada pela memória | Código |
| F13 | Alta | Banir e gerar novamente pode reutilizar o momento banido | Código |
| F14 | Média | Protocolo Python perde erros estruturados | Reproduzido |
| F15 | Alta | Falha de migração pode transformar testes em skips | Código |
| F16 | Média | Endpoint de mídia permite ler arquivos fora do armazenamento de mídia | Código; alcance local |

Prioridade alta indica bloqueio funcional, execução incorreta ou confiança indevida em resultados. Prioridade média indica degradação ou falha sob condição mais restrita. A ordem de implementação sugerida aparece ao final.

**F01 — O motor semântico ainda não está implementado de ponta a ponta.**

[`factory.ts:26`][factory] aceita somente `fixture` para visão e embeddings. [`gateway.ts:33`][gateway] delega `suggestMoments` e `analyzeNarrative` ao fixture; somente `directTimeline` chama o modelo real. [`fixture.ts:39`][fixture] descreve cenas pela quantidade de frames e presença de fala; os vetores são derivados de SHA-256, sem representação semântica aprendida.

Isso permite testar contratos e produzir MP4s, mas não sustenta a promessa de escolher memes pelo conteúdo visual e pelo significado da música. O Director real recebe candidatos e descrições limitados pelas etapas anteriores. Essa é uma lacuna declarada, não uma acusação de implementação enganosa.

**Correção:** implementar providers reais por capacidade: visão, embeddings, narrativa e momentos; manter fixtures explícitos para testes/demonstração. Expor no diagnóstico do projeto quais etapas foram simuladas. Persistir modelo, versão, prompt e revisão dos dados e reindexar o catálogo ao trocar embeddings. Validar com um pequeno conjunto editorial revisado por uma pessoa, medindo recuperação de candidatos relevantes antes de ajustar prompts do Director. Transcrição MLX e análise de áudio com librosa já têm caminhos reais opcionais; não precisam ser refeitas do zero.

**Exemplo de correção — composição por capacidade.** Adaptação proposta para `packages/model-providers`: os tipos `LLMProvider`, `VisionProvider` e `EmbeddingProvider` já existem. O descritor abaixo é novo; deve vir do registro controlado dos adapters, e não de uma escolha livre enviada pela interface.

```ts
import type { LLMProvider } from './types';

type Capability<T> = {
  implementation: T;
  mode: 'real' | 'fixture';
  model: string;
  version: string;
};

type LlmCapabilities = {
  moments: Capability<Pick<LLMProvider, 'suggestMoments'>>;
  narrative: Capability<Pick<LLMProvider, 'analyzeNarrative'>>;
  director: Capability<Pick<LLMProvider, 'directTimeline'>>;
};

export function composeLLM(
  adapters: LlmCapabilities,
  mode: 'production' | 'demo',
): LLMProvider {
  for (const [name, capability] of Object.entries(adapters)) {
    if (mode === 'production' && capability.mode !== 'real') {
      throw new Error(`CAPABILITY_NOT_READY: ${name}`);
    }
  }
  return {
    name: 'composed-llm',
    suggestMoments: input =>
      adapters.moments.implementation.suggestMoments(input),
    analyzeNarrative: input =>
      adapters.narrative.implementation.analyzeNarrative(input),
    directTimeline: input =>
      adapters.director.implementation.directTimeline(input),
  };
}
```

Aplicar a mesma verificação à visão e aos embeddings na factory. Esse exemplo elimina o fallback silencioso por capacidade; **não implementa os modelos ausentes**. Cada adapter real ainda precisa: executar inferência, validar a resposta com os contratos do projeto, conferir intervalos e dimensões e devolver a proveniência. No gateway atual, `moments` e `narrative` devem ser identificados como `fixture`, mesmo que `director` seja real.

Para embeddings, persistir uma identidade de espaço (`modelo + revisão + dimensões + normalização`) e só comparar vetores do mesmo espaço. Uma mudança de modelo exige novo índice/reindexação; dimensões iguais não garantem compatibilidade semântica. Avaliar Recall@K dos candidatos em um conjunto com escolhas editoriais conhecidas. O tamanho de K e a meta de aceitação devem ser definidos com esse conjunto, sem inventar uma taxa de qualidade.

**Aceite:** modo de demonstração explícito; modo real recusa capacidades ausentes; resultados registram proveniência; buscas nunca misturam espaços de embeddings.

**F02 — O algoritmo de cobertura pode produzir um falso `INSUFFICIENT_CATALOG`.**

Em [`coverage.ts:160`][coverage], a escolha de duração prioriza uma batida alcançável e marca o momento como usado. Se essa decisão prejudica a cobertura restante, o algoritmo não reconsidera os cortes anteriores; só tenta absorver a sobra no último clipe.

**Reprodução:** segmento de 4.000 ms, dois momentos distintos de 2.000 ms e ambos no ranking/shortlist. Sem batidas, o resultado é `2.000 + 2.000`. Com batidas em `0, 1.500, 3.000`, usa `1.500 + 1.500` e termina com `INSUFFICIENT_CATALOG: remainder 1000ms at 3000ms`. O material descartado dos dois momentos seria suficiente.

**Correção:** verificar a viabilidade do restante antes de aceitar o corte. Uma correção incremental é tentar novamente com as durações disponíveis, sem snap, antes de declarar insuficiência. Uma solução mais geral é busca limitada com retrocesso. A cobertura deve ter precedência sobre a preferência por batidas. Acrescentar exatamente o caso reproduzido como regressão, preservando também os casos em que o catálogo realmente não cobre o trecho.

**Exemplo de correção incremental — segunda tentativa sem snap.** Em `packages/director/src/coverage.ts`, renomear a implementação atual para `resolveCoverageOnce` e manter a função pública como wrapper. Os demais helpers permanecem no mesmo módulo.

```ts
// Renomear a função atual, mantendo seu corpo:
// function resolveCoverageOnce(input: ResolveCoverageInput): CoverageResolution

export function resolveCoverage(input: ResolveCoverageInput): CoverageResolution {
  try {
    return resolveCoverageOnce(input);
  } catch (error) {
    if (!(error instanceof InsufficientCatalogError) || input.beats.length === 0) {
      throw error;
    }
    const fallback = resolveCoverageOnce({ ...input, beats: [] });
    return {
      ...fallback,
      decisions: fallback.decisions.map(decision => ({
        ...decision,
        reason: `${decision.reason}; coverage retry without beat snap`,
      })),
    };
  }
}
```

O resolvedor atual mantém suas listas locais, portanto a tentativa descartada não publica clipes parciais. Esse wrapper corrige o caso reproduzido e preserva os candidatos autorizados. Não torna o algoritmo guloso completo para toda combinação possível: se ainda houver falsos negativos por ordem de candidatos ou slot mínimo, introduzir busca limitada que considere essas restrições. Não preencher a sobra com preto, repetição arbitrária ou candidato banido.

**Aceite:** o cenário de 4.000 ms passa a produzir dois slots de 2.000 ms; um catálogo com apenas um momento de 2.000 ms continua falhando para o mesmo segmento. Confirmar também continuidade e limite do source em todos os clipes.

**F03 — Resolver novamente os efeitos não é idempotente.**

[`cut-styles.ts:86`][cutstyles] remove o efeito anterior, mas calcula o novo `speed_up` adicionando duração ao `source.endMs` já ampliado. [`swap.ts:62`][swap] resolve a timeline inteira após qualquer troca, inclusive os clipes que não foram trocados. O worker de efeitos também usa a última timeline.

**Reprodução:** slot de 2.000 ms, source inicial `0–2.000`, momento disponível `0–3.100`. As execuções sucessivas retornaram source final `2.500`, depois `3.000` e, na terceira, removeram a aceleração por `no_source_handle`. O mesmo clipe perdeu seu estilo sem mudança de intenção editorial.

**Correção:** derivar o consumo sempre de dados canônicos: `sourceStart + ceil(slot × factor)`, sem somar sobre um resultado anterior. Ao retirar o estilo, restaurar o intervalo base. Separar intervalo editorial de consumo efetivo se necessário. O teste correto é `resolve(resolve(timeline)) == resolve(timeline)`; o teste existente que resolve duas vezes a entrada original verifica determinismo, não essa propriedade.

**Exemplo de correção — normalizar a base antes de resolver.** Em `resolveClipStyle`, substituir a construção de `withoutStyle` e o ramo de `speed_up` pelos trechos abaixo. Reutilizam tipos, constantes e helpers já presentes em `cut-styles.ts`.

```ts
// Depois de calcular slotMs e plain, antes de tratar requested:
const baseEndMs = clip.source.startMs + slotMs;
if (clip.source.startMs < bounds.startMs || baseEndMs > bounds.endMs) {
  throw new Error(`SOURCE_OUT_OF_BOUNDS: ${clip.id}`);
}
const withoutStyle: TimelineClip = {
  ...clip,
  source: { ...clip.source, endMs: baseEndMs },
  effects: clip.effects.filter(effect => !isCutEffect(effect)),
};

// Substitui apenas o ramo requested === 'speed_up':
if (requested === 'speed_up') {
  const consumedSourceMs = Math.ceil(slotMs * SPEED_UP_FACTOR);
  const endMs = clip.source.startMs + consumedSourceMs;
  if (endMs > bounds.endMs) {
    return {
      clip: withoutStyle,
      shape: plain,
      decision: clipDecision(clip.id, requested, 'none', 0, 'no_source_handle'),
    };
  }
  const effect = speedEffect(clip, SPEED_UP_FACTOR, requested);
  return {
    clip: {
      ...withoutStyle,
      source: { ...withoutStyle.source, endMs },
      effects: [...withoutStyle.effects, effect],
    },
    shape: { factor: SPEED_UP_FACTOR, consumedSourceMs, freezesTail: false },
    decision: clipDecision(clip.id, requested, 'speed_up', slotMs),
  };
}
```

Esse recorte mantém o contrato atual, no qual `source` cobre ao menos o slot mesmo em `slow_down`/`hold`. Não encurtar esses sources sem adaptar também `validateTimeline` e `buildFfmpegGraph`, que hoje exigem `sourceMs >= slotMs`. Fornecer os limites reais do momento no contexto; usar o source derivado como se fosse o limite original reduz a capacidade de resolver estilos novos.

O teste de regressão precisa alimentar a saída de uma execução na próxima:

```ts
const first = resolveCutStyles(input, context);
const second = resolveCutStyles(first.timeline, context);
const third = resolveCutStyles(second.timeline, context);
expect(second).toEqual(first);
expect(third).toEqual(first);
expect(first.timeline.clips[0]?.source.endMs).toBe(2500);
```

`input` é a fixture com slot `0–2000`, source `0–2000` e `speed_up`; `context` contém limites `0–3100`. Ao trocar a intenção para `none`, o mesmo clipe deve voltar a `source.endMs = 2000`, preservando efeitos de outras categorias.

**F04 — Misturar `concat` e `xfade` quebra a renderização.**

[`graph.ts:212`][graph] concatena trechos de cortes secos e passa o resultado diretamente ao próximo `xfade`. A saída do `concat` tem uma base de tempo diferente da do segmento individual normalizado por `fps`.

**Reprodução com três clipes de 2 segundos:** apenas cortes secos funcionou; crossfades consecutivos funcionaram; crossfade seguido de corte seco funcionou; **corte seco seguido de crossfade falhou**, embora `validateTimeline` retornasse `ok: true`. Erro: `First input link main timebase (1/1000000) do not match ... second input ... (1/30)`.

**Correção:** normalizar FPS e base de tempo nos dois operandos de cada `xfade`, inclusive acumuladores produzidos por `concat`. Na reprodução, adicionar `fps=30,settb=1/30` após o `concat` intermediário fez o mesmo caso concluir com código zero. Isso confirma a direção da correção, sem substituir testes das demais combinações, resoluções e taxas de quadros. A exigência de bases de tempo iguais está documentada pelo [FFmpeg][ffmpeg-doc].

O caso usa uma timeline válida com folgas de source. F05 explica por que o pipeline atual pode evitar esse caminho por downgrade; isso não torna o grafo correto para as timelines que o contrato aceita.

**Exemplo de correção — propagar FPS para os joins.** Estas substituições ficam em `packages/renderer/src/graph.ts`; o modelo atual usa FPS inteiro no canvas.

```diff
-  filterParts.push(...joinSegments(segments, transitions));
+  filterParts.push(...joinSegments(segments, transitions, fps));

-  if (params.pinFps) filters.push(`fps=${canvas.fps}`);
+  if (params.pinFps) {
+    filters.push(`fps=${canvas.fps}`, `settb=1/${canvas.fps}`);
+  }

 function joinSegments(
   segments: readonly Segment[],
   transitions: readonly TimelineTransitionOut[],
+  fps: number,
 ): string[] {

-      filter: `concat=n=${parts.length}:v=1:a=0`,
+      filter: `concat=n=${parts.length}:v=1:a=0,fps=${fps},settb=1/${fps}`,
```

O diff é um recorte das alterações, sem os trechos intermediários; não é um patch completo para `git apply`. Os segmentos individuais e todo acumulador saído de um `concat` passam a compartilhar a base de tempo esperada pelo próximo `xfade`. Manter a normalização de dimensões, SAR e pixel format do grafo. Se FPS racional for adicionado ao contrato, representar a fração explicitamente e adaptar a expressão.

**Aceite:** renderizar com FFmpeg real as sequências `hard → crossfade`, `crossfade → hard`, `crossfade → crossfade` e alternâncias de quatro ou mais clipes. Conferir exit code e duração de áudio/vídeo, não apenas a string do grafo. A normalização após `concat` já foi confirmada na reprodução isolada descrita acima.

**F05 — As transições sobrepostas ficam inviáveis pelo posicionamento dos clipes.**

[`coverage.ts:160`][coverage] posiciona cada source em `moment.startMs`. [`optimize.ts:118`][optimize] redimensiona o fim do source ao ajustar as batidas e mantém seu início. [`cut-styles.ts:268`][cutstyles] exige folga antes desse início para o clipe que recebe um crossfade/whip, dentro dos limites do momento. A diferença entre o início do clipe e o início do momento é zero no fluxo de montagem atual.

**Consequência:** as transições propostas são rebaixadas mesmo quando o momento é longo e poderia acomodar um posicionamento diferente. Reproduzi crossfade virando `dip_black` e whip virando `hard` com essa geometria, inclusive aumentando a folga no fim do momento.

**Correção:** reservar as folgas de entrada/saída durante a escolha do intervalo de source, considerando a intenção de transição, o fator de velocidade e os limites do momento. Acrescentar teste de integração que parta do Director e confirme ao menos um crossfade realmente renderizado. Testes com source manualmente deslocado comprovam o resolvedor, mas não a capacidade do pipeline de produzir esse caso.

**Exemplo de correção — calcular a geometria antes de fixar o source.** Helper novo, independente do banco, para o planejamento. `incomingMs`/`outgoingMs` representam apenas transições sobrepostas; passar zero para corte seco, dip e flash. Os valores precisam vir de uma política de duração compartilhada com Effects.

```ts
type SourcePlacement = {
  startMs: number;
  endMs: number;
  consumedSourceMs: number;
  trimStartMs: number;
  trimEndMs: number;
};

export function placeSource(p: {
  momentStartMs: number;
  momentEndMs: number;
  slotMs: number;
  factor: number;
  incomingMs: number;
  outgoingMs: number;
  holdMs: number;
}): SourcePlacement | null {
  const values = Object.values(p);
  if (values.some(value => !Number.isFinite(value)) ||
      p.momentStartMs < 0 || p.momentEndMs <= p.momentStartMs ||
      p.slotMs <= 0 || p.factor <= 0 || p.incomingMs < 0 ||
      p.outgoingMs < 0 || p.holdMs < 0 || p.holdMs >= p.slotMs) {
    throw new Error('INVALID_SOURCE_PLACEMENT');
  }
  const head = Math.ceil(p.incomingMs * p.factor / 2);
  const tail = p.holdMs > 0 ? 0 : Math.ceil(p.outgoingMs * p.factor / 2);
  const consumed = Math.ceil((p.slotMs - p.holdMs) * p.factor);
  const startMs = p.momentStartMs + head;
  // Preserva a exigência atual de sourceMs >= slotMs.
  const endMs = startMs + Math.max(p.slotMs, consumed);
  if (Math.max(endMs, startMs + consumed + tail) > p.momentEndMs) return null;
  return {
    startMs,
    endMs,
    consumedSourceMs: consumed,
    trimStartMs: startMs - head,
    trimEndMs: startMs + consumed + tail,
  };
}
```

Para momento `0–3000`, slot `2000`, fator `1`, entrada e saída de `400` ms e sem hold, o helper posiciona source `200–2200` e reserva leitura `0–2400`. Na integração, gravar apenas o intervalo nominal em `clip.source`; o renderer já expande a leitura pelos handles. Gravar `trimStartMs` como início do clipe aplicaria a folga duas vezes.

Executar esse planejamento após conhecer intenção/duração de transição e velocidade. Se o resultado for `null`, tentar outro intervalo/candidato ou registrar downgrade. Caso Timing mude o slot, recalcular a geometria a partir do momento original, nunca por deslocamentos cumulativos. Unificar o arredondamento com Effects/Renderer para evitar diferenças de 1 ms nas bordas.

**Aceite:** a timeline construída pelo pipeline, sem deslocamento manual no teste, contém crossfade/whip renderizável quando há source suficiente; o caso sem folga sofre downgrade justificado.

**F06 — A exportação final prioriza o proxy de prévia.**

[`normalize.ts:33`][normalize] cria um proxy H.264 com altura de até 720 pixels e uma versão de análise com altura de até 480. [`renderer/handler.ts:90`][rendererworker] escolhe `proxyPath ?? analysisPath ?? originalPath` para a exportação 1080×1920.

Assim, um original vertical em 1080×1920 passa por redução para aproximadamente 404×720 antes de voltar a 1080×1920. A redução é comprovada pela configuração; não medi a perda perceptual no catálogo real.

**Correção:** usar original ou um intermediário normalizado na resolução original para exportação; reservar o proxy à prévia. Distinguir explicitamente render de prévia e render final, registrando fonte e perfil no resultado. Considerar rotação, FPS e pixel format nessa troca, para manter a normalização que o renderer precisa.

**Exemplo de correção — seleção explícita da fonte.** Helper novo para `workers/renderer`; `originalPath` e `proxyPath` já existem no catálogo. O perfil deve integrar o payload do render e o hash do job.

```ts
type RenderProfile = 'preview' | 'final';

export function chooseRenderSource(
  asset: { originalPath: string; proxyPath: string | null },
  profile: RenderProfile,
): { path: string; origin: 'original' | 'proxy' } {
  if (profile === 'preview' && asset.proxyPath) {
    return { path: asset.proxyPath, origin: 'proxy' };
  }
  if (!asset.originalPath) throw new Error('ORIGINAL_NOT_AVAILABLE');
  return { path: asset.originalPath, origin: 'original' };
}
```

Resolver a chave selecionada para um caminho local antes de chamar FFmpeg e conferir disponibilidade. Uma exportação final que perdeu o original deve falhar com diagnóstico claro ou usar um intermediário de qualidade declarado; não cair automaticamente em `analysisPath`. Se necessário, adicionar `mezzaninePath` ao catálogo por migração e manter resolução/rotação/duração equivalentes ao original. Persistir perfil, origem e checksum da fonte junto ao render.

**Aceite:** um asset com original 1080×1920 e proxy 404×720 seleciona o original em `final` e o proxy em `preview`. Testar um original com metadados de rotação e outro com FPS variável antes de trocar o caminho padrão.

**F07 — A validação considera um vídeo muito mais curto como válido.**

[`validate-output.ts:13`][validateoutput] transforma qualquer discrepância superior a 100 ms em aviso e retorna `valid: true`. Não há teto para a discrepância. O worker aceita esse resultado e marca o projeto como `COMPLETED`.

**Reprodução:** metadados de saída com 1.000 ms, H.264/AAC e resolução/FPS corretos para uma timeline de 60.000 ms retornaram `valid: true`, com aviso de 59.000 ms de diferença. É um teste do validador; não significa que observei um projeto real exportar um segundo.

**Correção:** rejeitar discrepâncias superiores à tolerância definida por frames/amostras e pelo contrato de exportação. Conferir duração e cobertura dos streams de áudio e vídeo separadamente: a duração do contêiner, sozinha, pode esconder vídeo que termina antes do áudio. Validar também os limites reais do source consumido e das folgas, não apenas a duração declarada no JSON. Manter avisos para discrepâncias pequenas deliberadamente toleradas.

**Exemplo de correção mínima — transformar drift excessivo em falha.** Em `validate-output.ts`, manter a validação de dimensões/FPS/codecs e substituir o bloco final de duração pelo seguinte:

```ts
const driftMs = Math.abs(probe.durationMs - timeline.durationMs);
// Política inicial proposta: no máximo 100 ms ou dois frames.
// Validar/calibrar com as saídas reais do encoder usado pelo projeto.
const maxDriftMs = Math.max(DURATION_DRIFT_MS, Math.ceil(2000 / fps));
if (!Number.isFinite(probe.durationMs) || probe.durationMs <= 0) {
  return { valid: false, warnings };
}
if (driftMs > maxDriftMs) {
  warnings.push({
    code: 'DURATION_DRIFT',
    durationMs: driftMs,
    message: `duration mismatch: expected ${timeline.durationMs}, got ${probe.durationMs}`,
  });
  return { valid: false, warnings };
}
return { valid: true, warnings };
```

Isso corrige a aceitação arbitrária usando o `OutputProbe` existente, mas a duração do contêiner pode esconder um stream incompleto. A correção completa amplia `OutputProbe` e o parser do ffprobe com cobertura separada de áudio/vídeo: primeiro timestamp e último timestamp mais duração do frame/pacote. Se esses valores não puderem ser obtidos, retornar erro de probe, sem preencher artificialmente com a duração esperada.

```ts
// Contrato novo para a etapa adicional; valores já normalizados em ms.
export function coversTimeline(
  stream: { startMs: number; endMs: number },
  expectedMs: number,
  toleranceMs: number,
): boolean {
  return Number.isFinite(stream.startMs) && Number.isFinite(stream.endMs) &&
    expectedMs > 0 && toleranceMs >= 0 &&
    stream.endMs > stream.startMs &&
    Math.abs(stream.startMs) <= toleranceMs &&
    Math.abs(stream.endMs - expectedMs) <= toleranceMs;
}
```

Aplicar a verificação a ambos os streams antes de publicar. Calibrar a tolerância de áudio com padding/priming do encoder. O teste de metadados `1.000 versus 60.000 ms` deve retornar inválido; acrescentar mídia real com vídeo curto e áudio longo para exercitar o probe ampliado.

**F08 — O ciclo de vida dos jobs não recupera interrupções e não atualiza todas as falhas de domínio.**

[`claim.ts:15`][claim] busca apenas `PENDING` e grava `RUNNING`; não existe lease, heartbeat, proprietário ou recuperação de jobs abandonados no sistema revisado. O startup da API não reconcilia a fila. [`api/index.ts`][apiindex] fecha a API e o pool e chama `process.exit(0)` sem aguardar os drains disparados fora da requisição. Portanto, uma interrupção entre claim e conclusão deixa o job sem caminho automático de retomada.

Além disso, [`orchestrator.ts:90`][orchestrator] registra falha no job, mas não no projeto/asset. O renderer coloca o projeto em `RENDERING` antes de validar e não o muda para `FAILED` nos erros. Há atualizações explícitas para algumas falhas do normalizador e para `INSUFFICIENT_CATALOG`, mas não uma regra geral. A API expõe os jobs falhos; o problema é a inconsistência entre esse estado e o estado principal do projeto.

**Correção:** adotar lease com expiração e identidade da tentativa, recuperação no startup/periódica, encerramento que pare novos claims e aguarde/cancele subprocessos e um mecanismo de conclusão que atualize também o estado da entidade. Adicionar timeout ao FFmpeg do normalizador. Retentativas precisam preservar idempotência e respeitar um limite; não basta transformar todo `RUNNING` em `PENDING` sem verificar a posse da execução.

**Exemplo de correção — lease por tentativa.** SQL de referência para uma migração nova; atualizar também o schema Drizzle. Os campos existentes `attempts`, `max_attempts`, `started_at` e os estados podem ser reutilizados. `$1` é um token aleatório novo para cada claim, gerado pela aplicação; o intervalo de 60 segundos é ilustrativo e deve ser configurável.

```sql
ALTER TABLE jobs ADD COLUMN lease_token text;
ALTER TABLE jobs ADD COLUMN lease_expires_at timestamptz;

-- Claim atômico: pendente ou abandonado com tentativas restantes.
WITH candidate AS (
  SELECT id FROM jobs
  WHERE attempts < max_attempts
    AND (
      status = 'PENDING'
      OR (status = 'RUNNING' AND lease_expires_at < clock_timestamp())
    )
  ORDER BY priority DESC, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE jobs j
SET status = 'RUNNING',
    attempts = j.attempts + 1,
    started_at = clock_timestamp(),
    completed_at = NULL,
    lease_token = $1,
    lease_expires_at = clock_timestamp() + interval '60 seconds'
FROM candidate c
WHERE j.id = c.id
RETURNING j.*;
```

Manter no claim os filtros atuais por entidade/tipo e a política de recursos do runner. Na implantação da migração, parar os workers antigos e reconciliar os `RUNNING` sem lease; atribuir uma expiração aleatória a processos ainda ativos não é recuperação segura.

```sql
-- Heartbeat: $1 = jobId, $2 = token desta tentativa.
UPDATE jobs
SET lease_expires_at = clock_timestamp() + interval '60 seconds'
WHERE id = $1 AND status = 'RUNNING' AND lease_token = $2
  AND lease_expires_at > clock_timestamp()
RETURNING id;

-- Conclusão protegida: $3 = resultado JSON.
UPDATE jobs
SET status = 'COMPLETED', result = $3::jsonb,
    completed_at = clock_timestamp(), lease_token = NULL,
    lease_expires_at = NULL, error_code = NULL, error_message = NULL
WHERE id = $1 AND status = 'RUNNING' AND lease_token = $2
  AND lease_expires_at > clock_timestamp()
RETURNING id;
```

Zero linhas significa perda de posse: a tentativa deve parar e não pode publicar resultado nem iniciar etapas seguintes. Renovar durante FFmpeg/Python, por exemplo a cada 15 segundos para o lease ilustrado. Usar o mesmo predicado ao registrar falhas. Um processo antigo pode continuar consumindo CPU por um intervalo após perder a posse; cancelar seus subprocessos e usar destinos exclusivos, conforme F09.

Um reconciliador precisa finalizar também leases expirados sem tentativas restantes:

```sql
UPDATE jobs
SET status = 'FAILED', error_code = 'LEASE_EXPIRED',
    error_message = 'worker lease expired and attempts were exhausted',
    completed_at = clock_timestamp(), lease_token = NULL,
    lease_expires_at = NULL
WHERE status = 'RUNNING' AND attempts >= max_attempts
  AND lease_expires_at < clock_timestamp()
RETURNING entity_id, id;
```

Executar essa finalização sob a mesma coordenação de F09–F10 e atualizar o estado da entidade apenas se a geração ainda for atual. Falha terminal de uma geração antiga não deve marcar uma geração nova como `FAILED`. Rodar recuperação no startup e periodicamente; consultar a fila mesmo sem nova requisição HTTP. Backoff e orçamento de tentativas devem permanecer explícitos.

No encerramento, o runner precisa oferecer operações de parar claims, aguardar jobs ativos até um prazo e cancelar subprocessos. Só depois fechar o pool. Essas operações são **contratos a implementar**, não métodos existentes. Registrar duração, tentativa, código de falha, etapa, versão e stderr limitado ajuda a diagnosticar retomadas sem confundir repetição de tentativa com nova geração.

**Aceite:** interromper após claim, durante FFmpeg e antes da conclusão; reiniciar; concluir ou falhar de forma recuperável. Uma tentativa antiga não consegue renovar, concluir nem publicar após outra adquirir o job.

**F09 — Reprocessamento e alocação de versões não estão protegidos contra concorrência.**

[`reprocess.ts:53`][reprocess] apaga jobs antes de reenfileirar. [`queries.ts:31`][jobqueries] não filtra por estado: também apaga `RUNNING`. `generate`, `render`, reprocessamento direto e swap não compartilham uma exclusão mútua atômica. A verificação usada em edição de janela/deleção é um SELECT separado da alteração. Os bloqueios de botões do editor não protegem duas abas, CLI e API ou duas requisições próximas.

Se um job for apagado enquanto o handler está ativo, o handler continua podendo escrever timeline, arquivos e novos jobs. Duas gravações podem também ler a mesma versão e tentar inserir `max(version)+1`: [`timeline.ts:32`][timelineversions], [`render.ts:33`][projectrender] e [`window.ts:18`][window]. O índice único evita versões duplicadas, mas uma operação falha; a transação simples não serializa o SELECT. No renderer, o nome do MP4 é escolhido antes da transação de insert e o FFmpeg usa `-y`, tornando relevante evitar duas execuções sobre o mesmo destino.

**Correção:** serializar comandos por projeto/asset no banco e introduzir identidade de geração/tentativa. Cancelar/inutilizar uma geração sem apagar sua execução ativa; validar essa identidade antes de publicar resultados. Reservar versão e nome de artefato atomicamente e renderizar em arquivo temporário exclusivo antes da promoção. Para updates interativos, receber `expectedTimelineVersion`. O comportamento padrão de isolamento do PostgreSQL não transforma `SELECT max + INSERT` em contador concorrente seguro; ver [documentação][postgres-doc]. Esses cenários foram demonstrados pelo fluxo do código, não executados contra PostgreSQL nesta revisão.

**Exemplo de correção — registro único de coordenação por entidade.** Proposta de tabela nova. `entity_kind` permite aplicar o mesmo padrão a projeto e asset. `current_timeline_version` se aplica a projetos; assets podem mantê-lo em zero. Preencher os contadores a partir do histórico existente durante a migração, com os writers parados.

```sql
CREATE TABLE entity_execution (
  entity_kind text NOT NULL CHECK (entity_kind IN ('project', 'asset')),
  entity_id text NOT NULL,
  active_generation_id text,
  current_timeline_version integer NOT NULL DEFAULT 0,
  next_render_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (entity_kind, entity_id)
);

-- No início de cada comando e transação de publicação:
BEGIN;
SELECT active_generation_id, current_timeline_version
FROM entity_execution
WHERE entity_kind = 'project' AND entity_id = $1
FOR UPDATE;
-- A aplicação confere expectedTimelineVersion e a geração lida.
-- Se houver conflito, ROLLBACK e resposta de conflito ao comando.
-- Caso válido, realiza a alteração e o enqueue na mesma transação.
COMMIT;
```

Todos os writers precisam seguir o mesmo lock, incluindo CLI, API, workers, cancelamento e reprocessamento. Criar a linha de coordenação junto com a entidade; uma consulta que não encontrou linha não adquiriu exclusão mútua. O lock dura somente a transação curta, não a chamada LLM ou todo o FFmpeg.

Para reprocessar, criar uma nova geração e substituir `active_generation_id` sob o lock; marcar jobs antigos como `CANCELLED`, sem apagar seu histórico. Solicitar cancelamento do processo ativo. Qualquer writer da geração anterior deve conferir o registro antes de persistir. Reservar a versão do render atomicamente:

```sql
-- $1 = projectId, $2 = geração esperada.
UPDATE entity_execution
SET next_render_version = next_render_version + 1
WHERE entity_kind = 'project' AND entity_id = $1
  AND active_generation_id = $2
RETURNING next_render_version - 1 AS reserved_version;
```

É aceitável haver lacunas quando um render reservado falha. Para timeline/janela, usar contadores próprios ou manter `max + 1` sob o lock obrigatório da entidade e inserir na mesma transação. Preservar índices únicos como defesa adicional. Na publicação, conferir tanto geração quanto token/tentativa de F08.

**Exemplo de destino exclusivo:** a função abaixo apenas reserva o diretório. O nome local aleatório evita que dois FFmpegs compartilhem o mesmo MP4.

```ts
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

export async function allocateRenderTarget(rendersDirectory: string) {
  // rendersDirectory é interno, existente e validado contra storageDir.
  const directory = await mkdtemp(join(rendersDirectory, 'attempt-'));
  return {
    directory,
    encodingPath: join(directory, 'encoding.mp4'),
    readyPath: join(directory, 'ready.mp4'),
  };
}
```

Renderizar em `encodingPath`, executar probe/validação, renomear para `readyPath` no mesmo filesystem e publicar a referência no banco sob o lock. A URL deve resolver somente artefatos publicados, conforme F16. Se a transação rejeitar a geração/tentativa ou o processo cair antes dela, o arquivo permanece órfão e um reconciliador o remove posteriormente. Banco e filesystem não formam uma transação única: o projeto precisa dessa regra explícita. Se o lease puder expirar durante a transação de publicação, a gravação condicionada da conclusão deve falhar e provocar rollback.

**Aceite:** duas requisições sobre a mesma versão causam uma atualização aceita e um conflito, ou duas operações serializadas conforme o comando; nunca sobrescrita compartilhada. Reprocessar enquanto renderiza invalida a publicação antiga e preserva o histórico.

**F10 — A barreira entre etapas pode deixar de disparar a continuação.**

[`projects/barrier.ts:19`][projectbarrier] e [`media-catalog/barrier.ts:19`][assetbarrier] conferem se o job irmão está `COMPLETED`. São chamados dentro do handler, antes de o orchestrator completar o próprio job.

**Condição:** dois consumidores terminam etapas irmãs simultaneamente. A consulta de A encontra B em `RUNNING`; a de B encontra A em `RUNNING`; ambas retornam sem enqueue. Depois ambos viram `COMPLETED`, mas ninguém reavalia a barreira. A fila fica sem NARRATIVE ou VISION_ANALYZE. Um único `drain` sequencial normalmente evita esse interleaving; múltiplos consumidores podem produzi-lo.

**Correção:** registrar a conclusão e decidir o próximo passo com coordenação transacional por geração/entidade. Alternativamente, usar evento de conclusão durável e reconciliador com enqueue idempotente. Apenas mover a consulta para outro ponto sem definir atomicidade/isolamento não é uma garantia suficiente. Testar duas finalizações coordenadas por barreiras de teste.

**Exemplo de correção — conclusão e continuação na mesma transação.** Acrescentar identidade de geração e etapa lógica ao job. Estes campos são propostos; precisam de migração e backfill antes de obrigatoriedade. `step_key` identifica a ocorrência da etapa dentro da geração, e não uma tentativa de retry.

```sql
ALTER TABLE jobs ADD COLUMN generation_id text;
ALTER TABLE jobs ADD COLUMN step_key text;
CREATE UNIQUE INDEX jobs_generation_step_key
ON jobs (entity_id, generation_id, step_key)
WHERE generation_id IS NOT NULL AND step_key IS NOT NULL;
```

Fluxo transacional proposto; as chamadas abaixo são **pseudocódigo de novos helpers**, a serem implementadas usando a mesma transação/conexão:

```ts
await db.transaction(async tx => {
  await lockEntity(tx, entityKind, entityId); // registro de F09, FOR UPDATE
  await requireActiveGeneration(tx, entityId, generationId);
  await completeOwnedJobOrThrow(tx, jobId, leaseToken, output); // F08

  const done = await listCompletedStepKeys(tx, entityId, generationId);
  if (done.has('audio-analyze') && done.has('lyrics')) {
    await enqueueStepOnce(tx, {
      entityId,
      generationId,
      stepKey: 'narrative',
      type: 'NARRATIVE',
      input: immutableNarrativeInput,
    });
  }
});
```

O segundo finalizador espera o lock e, depois de adquiri-lo, consulta os estados já confirmados pelo primeiro. A consulta das dependências deve ocorrer **após** a aquisição do lock. O enqueue usa `ON CONFLICT` para a chave de etapa/geração e inclui `generationId` no input usado pelo hash de idempotência existente. Seu `resourceClass`, versão do worker e demais campos obrigatórios vêm do registro atual de workers.

Não chamar o helper atual de enqueue com uma conexão externa dentro desse fluxo: ele precisa aceitar o executor transacional. Também retirar dos handlers o disparo antecipado das barreiras. No catálogo, aplicar o mesmo padrão às dependências de `VISION_ANALYZE`. Um reconciliador pode repetir essa decisão de maneira idempotente para recuperar gerações antigas incompletas.

**Aceite:** teste de integração com dois consumidores, sincronizados para terminar juntos, cria exatamente um job seguinte. Repetir a notificação de conclusão não duplica a etapa; uma tentativa sem lease não altera estado.

**F11 — “Última versão” não identifica os dados corretos de uma execução.**

Payloads como `{ projectId }` não fixam janela, análise, catálogo, configuração ou timeline de origem. TIMING, EFFECTS e RENDER consultam `getLatestTimeline`; o renderer usa `getLatestEditWindow` e compara apenas duração. [`validate-timeline.ts`][validatetimeline] não compara o início do áudio com o início da janela selecionada. [`narrative/handler.ts`][narrativeworker] persiste a nova janela antes de concluir a nova análise.

**Cenário concreto:** existe uma timeline para `0–60s`. Uma nova seleção `60–120s` é persistida, mas a nova narrativa/geração falha. A timeline antiga continua disponível. Ao solicitar render, a checagem encontra 60 segundos em ambas e aceita a timeline antiga, que ainda recorta o áudio a partir de zero. Uma releitura da versão mais recente também pode fazer uma etapa consumir a saída de outra geração sob concorrência.

**Correção:** payload imutável com `generationId`, `editWindowId`, versões de análise e `sourceTimelineVersion`; fixar hash/versões relevantes do catálogo e dos providers. Publicar uma geração como atual apenas quando suas dependências estiverem prontas. O renderer deve validar identidade e intervalo da janela, não só duração. Manter `latest` como consulta de interface, não como vínculo entre etapas.

**Exemplo de correção — snapshot de entrada explícito.** Tipos propostos para os contratos do job e a proveniência da timeline; esses campos não existem integralmente na revisão atual. A versão da timeline deve identificar a linha persistida, além de seu número legível.

```ts
export type GenerationSnapshot = Readonly<{
  projectId: string;
  generationId: string;
  editWindowId: string;
  windowStartMs: number;
  windowEndMs: number;
  audioChecksum: string;
  analysisVersion: string;
  catalogRevision: string;
  providerConfigHash: string;
  constraintsRevision: string;
}>;

export type RenderJobInput = Readonly<{
  snapshot: GenerationSnapshot;
  sourceTimelineId: string;
  sourceTimelineVersion: number;
  profile: 'preview' | 'final';
}>;

export function assertWindowIdentity(
  snapshot: GenerationSnapshot,
  timeline: {
    generationId: string;
    editWindowId: string;
    durationMs: number;
    audio: { sourceStartMs: number };
  },
): void {
  const expectedDuration = snapshot.windowEndMs - snapshot.windowStartMs;
  if (expectedDuration <= 0 ||
      timeline.generationId !== snapshot.generationId ||
      timeline.editWindowId !== snapshot.editWindowId ||
      timeline.audio.sourceStartMs !== snapshot.windowStartMs ||
      timeline.durationMs !== expectedDuration) {
    throw new Error('TIMELINE_INPUT_MISMATCH');
  }
}
```

Carregar timeline e janela pelos IDs do payload e conferir pertencimento ao mesmo projeto. Os números/checksums do snapshot devem ser produzidos a partir do banco/artefato; não confiar no cliente para descrevê-los. Validar o payload em runtime, porque `Readonly` é uma proteção de TypeScript, não uma validação de JSON. Incluir os campos no hash do job e registrar a proveniência nas saídas de TIMING/EFFECTS.

As referências precisam apontar para dados retidos e imutáveis: análises, segmentos, matches, revisões de momentos e configuração usada. Apenas gravar um hash e continuar sobrescrevendo as linhas consultadas não permite reproduzir a geração. Versionar essas saídas ou guardar um snapshot suficiente; só remover dados antigos quando nenhuma geração/render retido os referenciar, segundo uma política explícita de retenção.

Manter separadas a janela desejada pelo usuário e a geração publicada. Uma nova janela pode ser salva como rascunho, mas só se torna origem do render atual depois de suas dependências concluírem. Renders históricos podem continuar acessíveis pela geração original, com a janela original identificada. Mudanças de banimentos durante execução exigem revalidação ou invalidação explícita, conforme F13; um snapshot não deve contornar restrições atuais por acidente.

**Aceite:** trocar `0–60000` por `60000–120000` não passa na comparação só por ter 60 segundos. Falha da nova geração mantém o histórico anterior identificado e impede publicar seu áudio como se fosse o da nova janela.

**F12 — A memória permanece gravada, mas perde o vínculo com o conteúdo reprocessado.**

[`moments.ts:14`][moments] gera novos IDs e `replaceMoments` apaga os anteriores. [`narrative.ts:19`][narrative] faz o mesmo com segmentos narrativos. O feedback preserva IDs antigos sem FK; porém, [`feedback-search.ts:29`][feedbacksearch] faz `INNER JOIN` com os momentos atuais, e [`aggregate.ts:45`][aggregate] indexa rejeições por `projectId:segmentId`.

**Consequência:** após extrair novamente os mesmos momentos, seus vetores de feedback deixam de participar do join; banimentos diretos e estatísticas continuam associados aos IDs antigos. Após refazer a narrativa, a rejeição estrita do mesmo segmento perde a chave. Banimento por asset e exclusão por intervalo têm comportamento diferente: usam a identidade estável do asset e continuam aplicáveis. Não afirmo que todos os tipos de memória desaparecem.

**Correção:** separar identidade editorial estável e versão da extração. Preservar o ID quando o mesmo conteúdo/intervalo reaparece e definir correspondência explícita quando os limites mudarem. Vincular memória a asset + intervalo + identidade editorial, mantendo snapshots históricos para avaliação. Testar reprocessamento após swap e banimento, inclusive a preservação das métricas históricas.

**Exemplo de correção — identidade editorial independente da extração.** Propor uma tabela estável de unidades editoriais e uma tabela de revisões. Cada revisão de momento mantém `editorialUnitId`, `extractionRunId` e seus dados; feedback referencia a unidade estável e guarda um snapshot da revisão avaliada. A substituição da extração deixa as revisões anteriores históricas, em vez de apagar o alvo do feedback.

O helper abaixo produz uma chave para reencontrar **exatamente o mesmo intervalo e conteúdo**. SHA-256 aqui serve somente à identidade, nunca como embedding semântico.

```ts
import { createHash } from 'node:crypto';

export function exactEditorialKey(p: {
  assetChecksum: string;
  startMs: number;
  endMs: number;
}): string {
  if (!p.assetChecksum || !Number.isInteger(p.startMs) ||
      !Number.isInteger(p.endMs) || p.startMs < 0 || p.endMs <= p.startMs) {
    throw new Error('INVALID_EDITORIAL_INTERVAL');
  }
  return createHash('sha256').update(JSON.stringify([
    'editorial-interval-v1', p.assetChecksum, p.startMs, p.endMs,
  ])).digest('hex');
}
```

Usar essa chave em um upsert de unidade editorial; uma nova extração com limites idênticos reutiliza a unidade e cria somente sua revisão. Intervalos levemente diferentes precisam de política de associação, com correspondência unívoca no mesmo asset; sobreposição temporal sozinha não garante que dois momentos expressem a mesma coisa. Guardar a decisão e sua origem, deixando casos ambíguos sem transferência automática de preferência.

Para segmentos narrativos, usar identidade baseada no projeto/conteúdo da música e intervalo editorial, separada da análise gerada. Quando a segmentação muda, aplicar correspondência explícita; não simplesmente copiar uma rejeição para qualquer segmento sobreposto.

**Migração:** reconstruir vínculos a partir dos snapshots/contextos históricos quando houver evidência suficiente; onde não houver, preservar o evento como histórico sem inventar o alvo. Adaptar joins de feedback para unidade editorial → revisão ativa. Banimentos por asset/intervalo existentes devem continuar funcionando durante a transição.

**Aceite:** reextrair o mesmo intervalo preserva banimento, estatística e recuperação do feedback. Mudança ambígua de limites não associa automaticamente o feedback ao momento errado.

**F13 — “Banir” não garante exclusão das novas timelines geradas pelo editor.**

O editor informa “Ele não entra em novas timelines” em [`projects/[id]/page.tsx`][editorpage]. O banimento grava feedback, mas não invalida os matches. [`generate.ts:13`][generate] recomeça no DIRECTOR; [`director/handler.ts`][directorworker] reutiliza ranked/shortlist persistidos e não filtra `listActiveBans`. MATCH faz essa filtragem e swap também verifica bans, mas o caminho de gerar novamente não passa por MATCH.

**Consequência:** banir um candidato e clicar para gerar novamente pode produzir outra timeline com esse candidato. O mesmo problema alcança restrições por asset/intervalo adicionadas depois do matching. Não é necessário apagar ou modificar o vídeo já exportado para corrigir isso.

**Correção:** revalidar as restrições atuais no Director e em seus fallbacks de cobertura, além de invalidar/recalcular matches quando restrições mudarem. Definir separadamente o comportamento para renders históricos. Testar a sequência `MATCH → BAN → GENERATE` e garantir ausência do banido na nova timeline.

**Exemplo de correção — filtrar o universo usado pelo Director e pelo fallback.** Em `workers/director/src/handler.ts`, após carregar os momentos e antes de montar `directorSegments`, usar `listActiveBans` de `@memetize/feedback`. `momentRows` e `matches` já existem nesse ponto. Substituir os mapas originais por mapas filtrados:

```ts
const bans = await listActiveBans(ctx.db);
const momentById = new Map(
  momentRows
    .filter(moment =>
      !bans.momentIds.has(moment.id) && !bans.assetIds.has(moment.assetId))
    .map(moment => [moment.id, moment]),
);
const filteredMatches = matches.map(match => ({
  ...match,
  shortlist: match.shortlist.filter(entry => momentById.has(entry.momentId)),
  ranked: match.ranked.filter(entry => momentById.has(entry.momentId)),
}));
const matchBySegment = new Map(
  filteredMatches.map(match => [match.segmentId, match]),
);
```

`listActiveBans` já converte exclusões por intervalo em IDs dos momentos atuais. Propagar esses mesmos mapas para `hydrateShortlist`, validação dos picks, montagem e `resolveCoverage`; manter o ranking antigo em algum fallback anularia a correção. Um pick do LLM fora dos candidatos permitidos deve ser rejeitado ou substituído apenas por candidato elegível.

Se nenhum candidato restar, solicitar MATCH novamente ou informar ausência de material elegível; não recuperar a lista anterior. Invalidar o cache de matching ao mudar bans acelera a atualização, mas o filtro na geração continua necessário.

Para fechar a janela entre consulta e publicação, manter uma revisão monotônica das restrições, incrementada sob coordenação sempre que um ban muda. Conferir a revisão ao publicar e revalidar os clipes se ela mudou; não manter uma transação aberta durante a chamada LLM. Essa revisão é um campo novo, alinhado a `constraintsRevision` de F11.

**Aceite:** `MATCH → BAN_MOMENT → GENERATE`, `MATCH → BAN_ASSET → GENERATE` e exclusão de intervalo respeitam as novas restrições, inclusive quando o fallback de cobertura é necessário.

**F14 — A ponte Python descarta o erro que o próprio protocolo produziu.**

Os entrypoints Python escrevem um `WorkerFailure` no stdout e saem com código 1. [`python.ts:66`][pythonbridge] rejeita imediatamente com o stderr quando o código não é zero. Os handlers TypeScript só fazem parse de `WorkerResult` depois que essa função resolve; logo, o erro estruturado do subprocesso não chega até esse parse.

**Reprodução:** subprocesso emitiu JSON com `code: MODEL_NOT_INSTALLED`, `message: dependency missing` e `retryable: true`, saindo com código 1. O chamador recebeu apenas `Python worker 'protocol-test' exited with code 1:`. O código, a mensagem e o indicador de retentativa foram perdidos.

**Correção:** retornar stdout, stderr e exit code; interpretar primeiro um `WorkerResult` válido, inclusive em saída não zero. Diferenciar falha de protocolo de falha declarada pelo worker. Preservar código, mensagem e retryability sem deixar um subprocesso inconsistente retornar sucesso. Acrescentar teste do caminho de erro, além do caminho de sucesso.

**Exemplo de correção — separar transporte e resultado do worker.** Em `packages/shared/src/python.ts`, ampliar o resultado e fazer o evento `close` devolver os dados independentemente do exit code. Erros de spawn e timeout continuam rejeitando como hoje.

```ts
export interface PythonRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

// Substituir o listener de close dentro de runPythonWorker:
child.on('close', (exitCode, signal) => {
  finish(() => resolvePromise({ stdout, stderr, exitCode, signal }));
});
```

Adicionar um decoder único, reutilizando o schema real `WorkerResult` de `packages/contracts/src/worker.ts`:

```ts
import { WorkerResult } from '@memetize/contracts';
import type { PythonRunResult } from './python';

export function decodePythonResponse(
  run: PythonRunResult,
  expectedJobId: string,
): WorkerResult {
  let raw: unknown;
  try {
    raw = JSON.parse(run.stdout);
  } catch {
    throw new Error(`PYTHON_PROTOCOL_INVALID_JSON: exit=${run.exitCode}`);
  }
  const parsed = WorkerResult.safeParse(raw);
  if (!parsed.success || parsed.data.jobId !== expectedJobId) {
    throw new Error('PYTHON_PROTOCOL_INVALID_RESPONSE');
  }
  if (run.signal !== null) {
    throw new Error(`PYTHON_PROCESS_INTERRUPTED: ${run.signal}`);
  }
  const result = parsed.data;
  if (result.status === 'failed') {
    return result; // Preserva error.code, error.message e error.retryable.
  }
  if (run.exitCode !== 0) {
    throw new Error(`PYTHON_PROTOCOL_SUCCESS_WITH_EXIT_${run.exitCode}`);
  }
  return result;
}
```

Nos handlers, chamar esse decoder após `runPythonWorker` e transformar `status: 'failed'` no `JobFailure` do orchestrator com os três campos originais. Registrar stderr limitado separadamente junto ao job; não usar stderr como substituto do erro estruturado. Atualizar todos os chamadores do transporte, pois deixar algum fazer apenas `JSON.parse(stdout)` aceitaria `success` com exit não zero.

**Aceite:** resposta `failed` com exit 1 preserva `MODEL_NOT_INSTALLED`, mensagem e retryability; JSON inválido é erro de protocolo; `success` com exit 1 é rejeitado; `jobId` trocado também é rejeitado.

**F15 — Uma migração quebrada pode fazer a suíte parecer aceitável por ter sido pulada.**

[`database/testing.ts:18`][dbtesting] envolve conexão e migração no mesmo `try/catch`; qualquer erro retorna `null`. Os testes usam `describe.skipIf(!handle)`. Isso inclui a condição em que `TEST_DATABASE_URL` foi configurada corretamente, mas a migração tem um defeito. Identifiquei 35 arquivos de teste TypeScript com `skipIf`; isso é inventário do código, não contagem de skips de uma execução.

**Correção:** permitir skip explícito apenas quando a infraestrutura opcional não foi solicitada. Se `TEST_DATABASE_URL` estiver definida, propagar falhas de conexão e migração. Criar um comando/gate de integração que exija PostgreSQL/pgvector, FFmpeg e dependências Python, execute as migrações e falhe se os testes obrigatórios não rodarem. A árvore consultada não contém workflows em `.github/workflows`; não verifiquei eventuais pipelines externos.

**Exemplo de correção — skip somente por ausência deliberada de configuração.** Substituição de `createTestDatabase` em `packages/database/src/testing.ts`, reutilizando os imports e `migrationsFolder` existentes:

```ts
export async function createTestDatabase(): Promise<DatabaseHandle | null> {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (!url) {
    if (process.env.REQUIRE_INTEGRATION_TESTS === '1') {
      throw new Error('TEST_DATABASE_URL is required for integration tests');
    }
    return null;
  }

  const handle = createDatabase(url, { max: 4 });
  try {
    await handle.sql`select 1`;
    await migrate(handle.db, { migrationsFolder });
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined); // Preserva o erro inicial.
    throw error;
  }
}
```

`REQUIRE_INTEGRATION_TESTS` é uma opção nova proposta. Um gate obrigatório pode executar `REQUIRE_INTEGRATION_TESTS=1 pnpm test`, com `TEST_DATABASE_URL` fornecida pelo ambiente e apontando a um banco descartável. O gate também deve verificar as dependências exigidas pelos casos reais de FFmpeg/Python e impedir skips desses casos. Não trocar o banco de teste por `DATABASE_URL`.

**Aceite:** uma migração SQL deliberadamente inválida em um banco de teste faz a execução falhar. Banco configurado mas indisponível também falha. O modo local opcional sem URL pode continuar pulando somente os testes que dependem desse banco. Não é necessário criar testes que apenas repitam o texto do helper: o comportamento de erro precisa ser exercitado.

**F16 — O endpoint de mídia tem como limite a raiz do repositório.**

[`media.ts:51`][mediaapi] resolve o arquivo em `runtime.config.rootDir`, verifica apenas se está dentro dessa raiz e permite fallback para `application/octet-stream`. Assim, o contrato permite servir `package.json` e, se existir, `.env`, sem que o caminho contenha `..`. O endpoint também precisa conferir que o destino é um arquivo regular e tratar symlinks de forma deliberada.

**Correção:** servir apenas artefatos de mídia autorizados, identificados por ID ou por caminho validado dentro de `storageDir`, com verificação do caminho real. Arquivos de configuração não devem ser atendidos. A API está vinculada a `127.0.0.1`; portanto, este achado tem alcance local na configuração atual. Não há evidência de exposição pública ou de vazamento efetivo de credenciais nesta análise.

**Exemplo de correção — resolver um artefato publicado por ID.** O endpoint proposto recebe `artifactId` e consulta um registro de artefatos publicados no projeto/catálogo, ou um resolver equivalente das tabelas existentes. `storageKey` e MIME vêm desse registro, nunca de parâmetros livres da requisição. O contrato abaixo é novo.

```ts
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

type PublishedMedia = {
  storageKey: string;
  mimeType: string;
};

const mediaTypes = new Set([
  'video/mp4', 'audio/mpeg', 'audio/wav',
  'image/jpeg', 'image/png', 'image/webp',
]);

export async function openPublishedMedia(
  storageDir: string,
  artifact: PublishedMedia,
) {
  if (!artifact.storageKey || isAbsolute(artifact.storageKey) ||
      !mediaTypes.has(artifact.mimeType)) {
    throw new Error('MEDIA_NOT_ALLOWED');
  }
  const root = await realpath(storageDir);
  const target = await realpath(resolve(root, artifact.storageKey));
  const rel = relative(root, target);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error('MEDIA_OUTSIDE_STORAGE');
  }
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('MEDIA_NOT_A_FILE');
    return { handle, size: stat.size, mimeType: artifact.mimeType };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
```

Usar o mesmo file descriptor para transmitir o corpo: `handle.createReadStream` aceita os limites calculados pelo `parseRange` existente. Fechar o handle ao terminar, em erro e em desconexão. Converter arquivo ausente/ID desconhecido em 404 e restrição inválida em erro controlado. A interface/CLI precisam passar a construir URLs por ID, inclusive thumbnails e áudio. JSONs de análise, quando necessários ao editor, devem ter endpoint próprio de dados autorizados.

O desenho pressupõe diretórios de artefatos controlados pela aplicação, sem troca concorrente de seus ancestrais por outros writers. `realpath` mais `O_NOFOLLOW` não constitui uma garantia universal contra um processo local que troca diretórios durante a abertura. Para esse modelo de ameaça adicional, usar isolamento do storage ou abertura relativa a diretórios com proteção específica do sistema operacional.

**Aceite:** IDs de mídia legítima atendem Range; `package.json`, `.env`, caminho absoluto, diretório e symlink para fora do storage não são servidos. Testes devem usar arquivos sintéticos, sem ler segredos reais.

**Outros problemas menores comprováveis, sem necessidade de ampliar a arquitetura.**

| Ponto | Evidência e efeito | Correção |
|---|---|---|
| A cópia da letra LRC de entrada é sobrescrita | [`ingest.ts`][ingest] copia para `lyrics.lrc`; [`lyrics/handler.ts`][lyricsworker] escreve a exportação normalizada nesse mesmo nome. Linhas/metadados que o parser não preserva são perdidos nessa cópia. | Separar `source-lyrics.lrc` de `generated-lyrics.lrc`; manter entrada imutável. |
| Nome original se perde no upload HTTP | [`upload.ts`][upload] gera `memetize-upload-<aleatório>.<ext>`; os ingestors persistem `basename(filePath)`. Pela API, a lista exibe o nome temporário, não o nome enviado. | Passar o nome original como metadado validado, separado do caminho temporário. |
| `STORAGE_PATH` absoluto não é resolvido consistentemente | [`config.ts`][config] aceita caminho absoluto, enquanto [`paths.ts:132`][projectpaths] usa `join(rootDir, relative)` para recuperar caminhos persistidos. A API também pressupõe caminho relativo ao repositório. | Persistir chaves relativas ao storage e resolver contra `storageDir`, ou rejeitar explicitamente configuração absoluta enquanto não suportada. |

**Exemplos para os três problemas menores.** São recortes propostos para os ingestors e resolvers; ajustar os campos persistidos e os consumidores juntos.

Para preservar letras, copiar a entrada uma vez e dar outro destino à saída normalizada. O diretório da geração deve ser novo e controlado pela aplicação; retries conferem checksum e reutilizam a entrada em vez de sobrescrevê-la.

```ts
import { constants } from 'node:fs';
import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function saveLrcArtifacts(
  generationDirectory: string,
  inputPath: string,
  normalizedLrc: string,
) {
  const sourcePath = join(generationDirectory, 'source-lyrics.lrc');
  const generatedPath = join(generationDirectory, 'generated-lyrics.lrc');
  await copyFile(inputPath, sourcePath, constants.COPYFILE_EXCL);
  await writeFile(generatedPath, normalizedLrc, { encoding: 'utf8', flag: 'wx' });
  return { sourcePath, generatedPath };
}
```

Na implementação atual, a cópia fica no ingestor e a escrita no worker de letras; o helper agrupa as duas operações apenas para mostrar seus destinos distintos. Não confundir essa gravação inicial com uma política completa de retry.

Para upload, transportar o nome original separado do arquivo temporário. A normalização abaixo é para metadado de exibição; não usar o resultado como chave de storage.

```ts
export function uploadedDisplayName(originalFilename: string): string {
  const leaf = originalFilename.split(/[\\/]/).at(-1) ?? '';
  const clean = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return clean && clean !== '.' && clean !== '..' ? clean : 'upload';
}

type IngestFileInput = {
  filePath: string;          // caminho temporário interno
  originalFilename: string;  // metadado de exibição
};
```

Adaptar `saveUpload` para retornar ambos e os ingestors para persistir `uploadedDisplayName(originalFilename)`. Na CLI, usar o basename do arquivo selecionado quando não houver nome informado separadamente.

Para storage, persistir chaves relativas ao diretório de armazenamento, independentemente de `STORAGE_PATH` ser absoluto ou relativo:

```ts
import { isAbsolute, relative, resolve, sep } from 'node:path';

export function resolveStorageKey(storageDir: string, key: string): string {
  if (!key || isAbsolute(key)) throw new Error('INVALID_STORAGE_KEY');
  const root = resolve(storageDir);
  const path = resolve(root, key);
  const rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error('INVALID_STORAGE_KEY');
  }
  return path;
}
```

Esse helper resolve a convenção de caminhos; a abertura de arquivos para HTTP ainda precisa do controle de F16. Migrar as referências antigas da raiz do repositório para chaves relativas ao storage e atualizar produtores, consumidores e timelines históricas de forma versionada. Não reescrever bytes de históricos arbitrariamente: um resolver legado explícito pode manter leitura enquanto a migração ocorre. Uma alternativa menor, até essa migração estar pronta, é rejeitar `STORAGE_PATH` absoluto na configuração com erro claro.

**Aceite:** a letra original conserva os bytes recebidos; uploads exibem o nome enviado; storage em `/dados/memetize` e dentro do repositório resolve o mesmo tipo de chave corretamente.

**A estrutura que vale preservar.** A separação entre catálogo e projeto musical, o contrato de timeline, funções puras para planejamento, workers pequenos, PostgreSQL com claim por `SKIP LOCKED`, histórico de timelines e a separação do FFmpeg em relação ao LLM são escolhas coerentes para execução local. Não encontrei ciclos de dependências declaradas que justifiquem reorganizar todo o monorepo. Os testes existentes são relevantes e numerosos; os problemas estão em cenários ausentes e em um mecanismo de skip permissivo, não na inexistência de testes.

Uma correção estrutural suficiente é manter CLI/API, módulos e PostgreSQL e fortalecer três fronteiras: **comando da entidade**, com exclusão mútua e versão esperada; **execução**, com geração, tentativa, inputs imutáveis e conclusão recuperável; **artefato**, com arquivo temporário exclusivo, validação e publicação atômica. Um único runner dedicado na máquina pode simplificar a coordenação de recursos, mas não exige fila externa nem infraestrutura distribuída.

**Sequência recomendada de correções.**

1. **Recuperar confiança nos resultados:** corrigir F15 e acrescentar as regressões reproduzidas para F02, F03, F04 e F07. Isso evita que um resultado verde signifique ausência de execução relevante.
2. **Corrigir o motor determinístico:** viabilidade de cobertura, efeitos idempotentes, normalização de timebase, reservas para transições, validação de streams e fonte correta da exportação. O mesmo plano deve gerar o mesmo consumo de source ao ser recalculado.
3. **Proteger o fluxo:** resolver F08–F11 com geração imutável, coordenação por entidade, retomada e publicação de artefatos. Juntar swap, feedback e enqueues relacionados em uma transação/outbox para evitar efeitos parciais.
4. **Preservar a intenção editorial:** corrigir identidades de memória e fazer banimentos valerem também na geração a partir de matches existentes.
5. **Completar a IA:** ativar capacidades reais, reprocessar/reindexar o catálogo e avaliar seleção semântica com material representativo. Qualidade narrativa, humor e adequação à música precisam de avaliação editorial; os testes determinísticos não medem isso.
6. **Fechar os pontos operacionais:** corrigir protocolo Python, limite do endpoint de mídia, letras imutáveis e metadados/caminhos de upload.

**Como aplicar as correções sem perder o histórico.**

| Grupo | Mudança no banco/contrato | Aplicação e validação |
|---|---|---|
| F02–F04, F07 | Correções locais; probe ampliado demanda contrato novo | Começar pelas reproduções, aplicar recortes e executar FFmpeg real |
| F05–F06 | Política compartilhada de source; perfil de render | Integrar Director/Timing/Effects/Renderer e comparar prévia/exportação |
| F08–F11 | Lease, geração, coordenação, inputs e saídas com proveniência | Migrações aditivas, backfill consistente, atualização de todos os writers e testes de interrupção/concorrência |
| F12–F13 | Identidade editorial e revisão de restrições | Preservar eventos/revisões antigas; testar reprocessamento e banimento posterior ao MATCH |
| F01 | Adapters por capacidade e identidade de espaço vetorial | Implementar inferência real, reindexar e avaliar recuperação/seleção com material representativo |
| F14–F16 e menores | Transporte Python, política de testes, resolução de mídia e caminhos | Atualizar todos os consumidores; validar erros, Range e compatibilidade com dados existentes |

Para F08–F13, uma implantação consistente é: parar claims e aguardar/cancelar tentativas antigas; aplicar migrações aditivas e preencher identidades/contadores; iniciar o runner atualizado com reconciliador; confirmar retomada e publicação; somente depois retirar campos e caminhos legados. Não apagar jobs, feedback ou timelines para fazer os índices novos aceitarem os dados.

**Estado dos exemplos.** Os códigos são propostas vinculadas ao código revisado. Trechos identificados como pseudocódigo descrevem helpers novos e não são funções existentes no repositório. SQL de migração e fluxos transacionais não foram executados contra PostgreSQL. Nenhuma correção deste documento foi aplicada à branch `main`.

As verificações locais dos exemplos são registradas abaixo; passar nelas não equivale a aprovação da aplicação completa ou dos testes de integração.

| Verificação local dos exemplos | Resultado e alcance |
|---|---|
| Sintaxe dos 20 blocos TypeScript | Analisada pelo Node 24.19.0; recortes de corpo de função foram envolvidos em função. Sem typecheck do workspace ou resolução de todas as APIs propostas. |
| F01: composição e bloqueio de fixture | Modo real rejeitou capacidades simuladas; encaminhamento em demo funcionou. Sem inferência de modelo real. |
| F02: wrapper aplicado em cópia do módulo | O caso com batidas cobriu 4.000 ms; catálogo realmente insuficiente continuou falhando. |
| F03: recortes aplicados em cópia do módulo | Três resoluções mantiveram o mesmo resultado; retirar speed_up restaurou o source base. |
| F04: mudanças aplicadas em cópia do grafo | Seis sequências de cortes/transições renderizadas no FFmpeg 6.1.1, incluindo alternâncias com quatro e cinco clipes; áudio e vídeo ficaram a até 100 ms da duração esperada. Mídia sintética 96×160 a 30 fps. |
| F05–F07: geometria, fonte e duração | Helpers cobriram folgas suficientes/insuficientes e seleção original/proxy. Validador corrigido rejeitou 1 s para timeline de 60 s e NaN. Sem integração completa Director → exportação. |
| F09: alocação de diretório | Duas reservas geraram destinos diferentes. SQL, publicação atômica e concorrência de banco ainda não executados. |
| F11–F12: identidade | Comparação rejeitou janela diferente com igual duração; chave editorial manteve identidade exata e distinguiu intervalo alterado. Sem migração ou associação aproximada. |
| F14: transporte modificado | Subprocesso Python com exit 1 preservou stdout estruturado, exit code e sinal. Decoder com schema e integração com JobFailure ainda não executados. |
| F16: abertura de arquivos sintéticos | Arquivo permitido abriu; diretório, MIME não permitido, caminho externo e symlink para fora foram rejeitados. Sem teste HTTP completo/Range. |
| Três correções menores | Cópia LRC preservou bytes; segunda gravação exclusiva falhou; nomes e chaves de storage passaram nos casos isolados. Sem migração de dados existentes. |

Essas verificações ocorreram em cópias temporárias e helpers extraídos dos exemplos, sem alterar o espelho de código auditado nem a branch remota. Para os módulos carregados sem instalar o monorepo, foi usado o mesmo resolvedor TypeScript descrito no escopo. F08, F10, F13 e F15 permanecem pendentes dos testes de banco/integração especificados em seus critérios de aceite.

**Critérios de aceite propostos.**

| Cenário | Resultado exigido |
|---|---|
| 2 momentos de 2s, segmento de 4s, batidas em 0/1,5/3s | Cobertura de 4s; não declarar catálogo insuficiente |
| Recalcular efeitos de uma timeline já resolvida | Mesmo source e mesmos efeitos dos clipes inalterados |
| Corte seco → crossfade e alternâncias mais longas | FFmpeg termina sem incompatibilidade; duração dentro da tolerância |
| Director propõe crossfade com source suficiente | Folgas planejadas e ao menos uma transição efetivamente sobreposta |
| Original vertical 1080×1920 | Exportação final usa original/intermediário de qualidade, com origem registrada |
| Duração/stream de saída incompatível | Render não é publicado como válido |
| Encerrar/reiniciar durante normalização e render | Retomada ou falha recuperável; sem job eternamente RUNNING |
| Duas requisições de reprocessar/renderizar o mesmo projeto | Coordenação definida; sem apagar worker ativo nem compartilhar destino de escrita |
| Etapas irmãs terminam juntas | Continuação enfileirada uma única vez |
| Trocar janela por outra de igual duração e falhar a geração | Timeline antiga não é exportada como se correspondesse à nova janela |
| Banir → gerar novamente; reextrair após feedback | Restrição respeitada e memória vinculada ao conteúdo correto |
| Python retorna WorkerFailure com exit 1 | Código/mensagem/retryability preservados |
| Migração inválida com banco de teste configurado | Testes falham, sem conversão silenciosa em skip |
| Requisição de configuração pelo endpoint de mídia | Rejeitada; mídia legítima e Range continuam funcionando |

**O que esta análise não permite concluir.** Não medi tempo de render, memória ou temperatura no M4; não determinei se o timeout atual é adequado para seu catálogo; não avaliei acerto semântico, sincronismo perceptual ou qualidade estética com música e memes reais; não verifiquei serviços externos de CI nem declarei versões de dependências vulneráveis. O caminho librosa usa heurísticas para downbeats e rótulos de seções; isso merece avaliação musical, mas não foi tratado como defeito comprovado de reconhecimento. Nenhum commit, issue, PR ou alteração remota foi criado durante a revisão.

**Referências de código** — todos os links abaixo apontam para o commit fixado, não para uma branch que pode mudar.

[factory]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/model-providers/src/factory.ts#L26
[gateway]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/model-providers/src/gateway.ts#L33
[fixture]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/model-providers/src/fixture.ts#L39
[coverage]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/director/src/coverage.ts#L160
[cutstyles]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/effects/src/cut-styles.ts#L86
[swap]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/projects/src/swap.ts#L62
[graph]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/renderer/src/graph.ts#L212
[optimize]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/timing/src/optimize.ts#L118
[normalize]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/workers/video-normalizer/src/normalize.ts#L33
[rendererworker]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/workers/renderer/src/handler.ts#L90
[validateoutput]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/renderer/src/validate-output.ts#L13
[claim]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/job-system/src/claim.ts#L15
[apiindex]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/apps/api/src/index.ts#L1
[orchestrator]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/orchestrator/src/orchestrator.ts#L47
[reprocess]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/projects/src/reprocess.ts#L53
[jobqueries]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/job-system/src/queries.ts#L31
[timelineversions]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/projects/src/timeline.ts#L32
[projectrender]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/projects/src/render.ts#L33
[window]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/projects/src/window.ts#L18
[projectbarrier]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/projects/src/barrier.ts#L19
[assetbarrier]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/media-catalog/src/barrier.ts#L19
[validatetimeline]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/renderer/src/validate-timeline.ts#L30
[narrativeworker]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/workers/narrative-analyzer/src/handler.ts#L30
[moments]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/media-catalog/src/moments.ts#L14
[narrative]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/projects/src/narrative.ts#L19
[feedbacksearch]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/retriever/src/feedback-search.ts#L29
[aggregate]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/feedback/src/aggregate.ts#L45
[editorpage]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/apps/web/src/app/projects/%5Bid%5D/page.tsx#L215
[generate]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/projects/src/generate.ts#L13
[directorworker]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/workers/director/src/handler.ts#L75
[pythonbridge]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/shared/src/python.ts#L66
[dbtesting]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/database/src/testing.ts#L18
[mediaapi]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/apps/api/src/routes/media.ts#L51
[ingest]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/projects/src/ingest.ts#L40
[lyricsworker]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/workers/lyrics/src/handler.ts#L99
[upload]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/apps/api/src/upload.ts#L9
[config]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/shared/src/config.ts#L113
[projectpaths]: https://github.com/thethiago27/memetize/blob/a598f1469e9a242b59407ddd0dc30a67643139db/packages/projects/src/paths.ts#L132
[ffmpeg-doc]: https://ffmpeg.org/ffmpeg-filters.html#xfade
[postgres-doc]: https://www.postgresql.org/docs/current/transaction-iso.html
