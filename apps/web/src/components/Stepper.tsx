import type { ProjectJob } from '../lib/api';
import { JOB_STATUS_LABEL, PIPELINE_STEPS } from '../lib/labels';

export function latestJobByType(jobs: ProjectJob[]): Map<string, ProjectJob> {
  const latest = new Map<string, ProjectJob>();
  for (const job of jobs) {
    const current = latest.get(job.type);
    if (!current || job.createdAt > current.createdAt) latest.set(job.type, job);
  }
  return latest;
}

export function Stepper({ jobs }: { jobs: ProjectJob[] }) {
  const latest = latestJobByType(jobs);
  return (
    <section className="stepper" aria-label="Etapas do pipeline">
      {PIPELINE_STEPS.map((step) => {
        const job = latest.get(step.type);
        const state = job?.status ?? 'NONE';
        return (
          <div
            key={step.type}
            className="step"
            data-state={state}
            title={
              job
                ? `${step.label}: ${JOB_STATUS_LABEL[job.status] ?? job.status}`
                : `${step.label}: ainda não rodou`
            }
          >
            <div className="step-bar" />
            <span className="step-label">{step.label}</span>
          </div>
        );
      })}
    </section>
  );
}
