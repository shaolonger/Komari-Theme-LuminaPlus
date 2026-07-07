import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Clock3, Unplug } from "lucide-react";
import type { HomepagePingSourceRow } from "@/utils/homepagePingSources";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";

const LOSS_DOT_COUNT = 5;

function sourceMeta(source: HomepagePingSourceRow) {
  return source.group || source.target || `ID ${source.taskId}`;
}

function readingLabel(value: string, unit: string, available: boolean) {
  return (
    <span className="ping-source-reading-value tabular">
      {value}
      {available && <small>{unit}</small>}
    </span>
  );
}

export function PingSourceMatrix({
  rows,
  compareUrl,
  density = "regular",
}: {
  rows: HomepagePingSourceRow[];
  compareUrl: string;
  density?: "regular" | "compact";
}) {
  if (rows.length === 0) return null;

  return (
    <div className="ping-source-matrix" data-density={density}>
      <div className="ping-source-matrix-head">
        <span className="ping-source-matrix-title">
          Ping 来源
          <b>{rows.length}</b>
        </span>
        <Link to={compareUrl} className="ping-source-matrix-link">
          <BarChart3 size={12} strokeWidth={2.1} />
          <span>对比</span>
        </Link>
      </div>
      <div className="ping-source-list">
        {rows.map((source) => {
          const latencyColor = latencyHeatColor(source.latencyMs);
          const lossColor = lossHeatColor(source.lossPercent);
          const style = {
            "--ping-source-latency-fill": `${Math.round(source.latencyRatio * 100)}%`,
            "--ping-source-latency-color": latencyColor,
            "--ping-source-loss-color": lossColor,
          } as CSSProperties;

          return (
            <div
              key={source.taskId}
              className="ping-source-row"
              data-status={source.status}
              style={style}
              title={source.title}
            >
              <span className="ping-source-name">
                <strong>{source.name}</strong>
                <small>{sourceMeta(source)}</small>
              </span>
              <span className="ping-source-readings">
                <span className="ping-source-reading is-latency">
                  <span className="ping-source-reading-head">
                    <Clock3 size={10} strokeWidth={2.2} />
                    {readingLabel(source.latencyShortLabel, "ms", source.latencyMs != null)}
                  </span>
                  <span className="ping-source-latency-rail" aria-hidden>
                    <span />
                  </span>
                </span>
                <span className="ping-source-reading is-loss">
                  <span className="ping-source-reading-head">
                    <Unplug size={10} strokeWidth={2.2} />
                    {readingLabel(source.lossShortLabel, "%", source.lossPercent != null)}
                  </span>
                  <span className="ping-source-loss-dots" aria-hidden>
                    {Array.from({ length: LOSS_DOT_COUNT }, (_, index) => (
                      <span
                        key={index}
                        data-active={index < source.lossDotCount ? "true" : "false"}
                      />
                    ))}
                  </span>
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
