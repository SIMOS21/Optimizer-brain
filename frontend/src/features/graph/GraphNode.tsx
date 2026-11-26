import { memo, useContext } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StudioNode } from "./projection";
import { GraphModeContext } from "./graph-view-context";

export const OrganizationNode = memo(function OrganizationNode({
  data,
  id,
}: NodeProps<StudioNode>) {
  const mode = useContext(GraphModeContext);
  const resource = data.kind === "resource";
  return (
    <div className={`studio-node ${data.kind}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="node-kicker">
        <span>{resource ? "RESSOURCE" : "DÉPARTEMENT"}</span>
        <span className="node-symbol" aria-hidden="true">
          {resource ? "R" : "D"}
        </span>
      </div>
      <strong>{data.label}</strong>
      <small>{resource ? "Capacité déclarée" : "Responsable déclaré"}</small>
      <span className="map-node-value">
        {resource ? data.capacity : data.ownerLabel || "Non renseigné"}
      </span>
      {resource && <small>Département propriétaire : {data.ownerLabel}</small>}
      {mode === "expert" && (
        <span className="map-node-technical">
          {id} · v{data.version}
        </span>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});
