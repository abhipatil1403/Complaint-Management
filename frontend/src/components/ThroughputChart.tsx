export function ThroughputChart({
  buckets,
}: {
  buckets: { label: string; intake: number; resolved: number }[];
}) {
  const max = Math.max(1, ...buckets.flatMap((b) => [b.intake, b.resolved]));
  return (
    <>
      <div className="chart-legend">
        <span>
          <i style={{ background: "#155a37" }} />
          Received
        </span>
        <span>
          <i style={{ background: "#8fc9a9" }} />
          Resolved
        </span>
      </div>
      <div
        className="throughput-chart"
        role="img"
        aria-label={buckets
          .map(
            (b) => `${b.label}: ${b.intake} received, ${b.resolved} resolved`,
          )
          .join("; ")}
      >
        {buckets.map((b) => (
          <div className="throughput-column" key={b.label}>
            <div className="throughput-bars">
              <div
                title={`${b.intake} submissions received`}
                style={{ height: `${(b.intake / max) * 100}%` }}
              >
                <span>{b.intake || ""}</span>
              </div>
              <div
                title={`${b.resolved} cases resolved`}
                className="resolved-bar"
                style={{ height: `${(b.resolved / max) * 100}%` }}
              >
                <span>{b.resolved || ""}</span>
              </div>
            </div>
            <small>{b.label}</small>
          </div>
        ))}
      </div>
    </>
  );
}
