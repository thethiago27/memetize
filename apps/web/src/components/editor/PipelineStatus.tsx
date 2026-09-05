import type { ProjectDetail, ProjectJob } from '../../lib/api';
import { JOB_LABEL } from '../../lib/labels';
import { Stepper } from '../Stepper';

/**
 * One compact line: the pipeline step chips, then only the notices that
 * apply (failed step, stale render). The edit window lives in the header.
 */
export function PipelineStatus({
  detail,
  failedJobs,
  stale,
}: {
  detail: ProjectDetail;
  failedJobs: ProjectJob[];
  /** The latest timeline is newer than the latest render. */
  stale: boolean;
}) {
  return (
    <div className="pipeline-line">
      <Stepper jobs={detail.jobs} />
      {failedJobs.map((job) => (
        <span key={job.id} className="notice notice-inline" data-tone="bad">
          <strong>{JOB_LABEL[job.type] ?? job.type} falhou</strong>
          {job.errorCode ? ` · ${job.errorCode}` : ''}
          {job.errorMessage ? ` — ${job.errorMessage}` : ''}
          {job.errorCode === 'INSUFFICIENT_CATALOG'
            ? ' Adicione mais vídeos, ou vídeos mais longos, à biblioteca e gere a timeline de novo.'
            : ''}
        </span>
      ))}
      {stale ? (
        <span className="notice notice-inline">
          Timeline mais nova que o render: o preview mostra o storyboard. Renderize para ver o
          vídeo.
        </span>
      ) : null}
    </div>
  );
}
