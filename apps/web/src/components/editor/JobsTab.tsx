import type { ProjectJob } from '../../lib/api';
import { JOB_LABEL, JOB_STATUS_LABEL, jobTone } from '../../lib/labels';
import { StatusPill } from '../StatusPill';

export function JobsTab({ jobs }: { jobs: ProjectJob[] }) {
  if (jobs.length === 0) return <p className="mute">Nenhum job ainda.</p>;
  return (
    <>
      {jobs.map((job) => (
        <div key={job.id} className="row">
          <span className="cluster">
            <StatusPill
              label={JOB_STATUS_LABEL[job.status] ?? job.status}
              tone={jobTone(job.status)}
            />
            <span>{JOB_LABEL[job.type] ?? job.type}</span>
          </span>
          <span className={job.errorCode ? 'mono small err' : 'mono mute small'}>
            {job.errorCode
              ? `${job.errorCode} ${job.errorMessage ?? ''}`
              : new Date(job.createdAt).toLocaleString('pt-BR')}
          </span>
        </div>
      ))}
    </>
  );
}
