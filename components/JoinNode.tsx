import { Position, useNodesData, useReactFlow, type NodeProps, type Node, useNodeConnections } from '@xyflow/react';
import { useEffect } from 'react';
import type { NodeData } from '../App';
import NodeContainer from './NodeContainer';
import HelpLabel from './HelpLabel';
import { getNodeCategory, getNodeHelp } from '../nodeRegistry';
import { processEscapes } from '../utils/processEscapes';

type JoinNodeData = NodeData & {
  separator?: string;
  rawSeparator?: string;
  parseEscapes?: boolean;
};

export default function JoinNode({ id, data, selected, type }: NodeProps<Node<JoinNodeData>>) {
  const { updateNodeData } = useReactFlow();
  const helpInfo = getNodeHelp(type);
  const allConnections = useNodeConnections({ handleType: 'target' });

  const toggleHelp = () => {
    updateNodeData(id, { helpActive: !data.helpActive });
  };

  // Separate separator connection from input connections
  const separatorConnection = allConnections.find(c => c.targetHandle === 'separator');
  const separatorSourceId = separatorConnection?.source;

  // Build map of input handle connections (excluding separator)
  const handleConnections = new Map<string, string>();
  allConnections.forEach(conn => {
    const handleId = conn.targetHandle || 'input-0';
    if (handleId !== 'separator') {
      handleConnections.set(handleId, conn.source);
    }
  });

  // Determine how many input handles we need (at least 2, plus one extra if all filled)
  const connectedInputCount = handleConnections.size;
  const totalInputHandles = Math.max(2, connectedInputCount + 1);

  // Get all source IDs in handle order for input handles
  const inputSourceIds: string[] = [];
  for (let i = 0; i < totalInputHandles; i++) {
    const handleId = `input-${i}`;
    const sourceId = handleConnections.get(handleId);
    if (sourceId) {
      inputSourceIds.push(sourceId);
    }
  }

  // Combine separator source + input sources for useNodesData
  const allSourceIds = separatorSourceId
    ? [separatorSourceId, ...inputSourceIds]
    : inputSourceIds;

  const nodesData = useNodesData(allSourceIds);

  // Extract separator value from connected node (if connected)
  let separatorValue: string;
  if (separatorSourceId) {
    const sepNodeData = nodesData[0]?.data as NodeData | undefined;
    separatorValue = sepNodeData?.value ?? '';
  } else {
    // Use local fallback value
    const raw = data.rawSeparator ?? data.separator ?? '';
    separatorValue = data.parseEscapes ? processEscapes(raw) : raw;
  }

  // Extract input values in handle order
  const inputNodesData = separatorSourceId ? nodesData.slice(1) : nodesData;
  const inputValues = inputNodesData.map(node => ((node?.data as NodeData | undefined)?.value ?? ''));
  const inputsString = inputValues.join('|||');

  useEffect(() => {
    if (inputSourceIds.length === 0) {
      if (data.value !== '') {
        updateNodeData(id, { value: '' });
      }
      return;
    }

    const outputValue = inputValues.join(separatorValue);

    if (data.value !== outputValue) {
      updateNodeData(id, { value: outputValue });
    }
  }, [inputsString, separatorValue, inputSourceIds.length, id, updateNodeData, data.value]);

  const handleSeparatorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    updateNodeData(id, {
      rawSeparator: raw,
      separator: raw,
      value: inputValues.length > 0
        ? inputValues.join(data.parseEscapes ? processEscapes(raw) : raw)
        : data.value,
    });
  };

  const handleToggleEscapes = (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    const raw = data.rawSeparator ?? data.separator ?? '';
    updateNodeData(id, {
      parseEscapes: enabled,
      separator: raw,
    });
  };

  // Handle positions in rem
  const HANDLE_START = 4.6;
  const HANDLE_SPACING = 2;

  // Total handles = separator + input handles
  const totalHandles = 1 + totalInputHandles;
  const minHeight = HANDLE_START + (totalHandles - 1) * HANDLE_SPACING + 1;

  return (
    <div className={`node-help-wrapper ${data.helpActive ? 'help-active' : ''}`}>
      {data.helpActive && helpInfo && (
        <div className="node-help-frame">
          <div
            className="help-description"
            dangerouslySetInnerHTML={{ __html: helpInfo.description }}
          />
        </div>
      )}

      <NodeContainer
        id={id}
        selected={selected}
        title="Join"
        style={{ minWidth: '180px', minHeight: `${minHeight}rem` }}
        isDarkMode={data.isDarkMode}
        category={getNodeCategory(type)}
        onHelpToggle={toggleHelp}
        helpActive={data.helpActive}
      >
        <div className="node-description">
          Joins multiple inputs together
        </div>

        {/* Separator fallback UI (only when not connected) */}
        {!separatorSourceId && (
          <div className="node-field">
            <label className="node-label-invisible" >
              Separator:
            </label>
            <input
              className="nodrag node-input"
              type="text"
              value={data.rawSeparator ?? data.separator ?? ''}
              onChange={handleSeparatorChange}
              placeholder="Type or connect separator"
            />
            <label className="nodrag node-label" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', marginTop: '4px', opacity: 0.7, cursor: 'pointer' }}>
              <input
                className="nodrag"
                type="checkbox"
                checked={!!data.parseEscapes}
                onChange={handleToggleEscapes}
              />
              Parse escapes (\n, \t, \_, \\)
            </label>
          </div>
        )}

        {/* Separator input label */}
        {separatorSourceId && (
          <div className={data.isDarkMode ? "handle-label-dark" : "handle-label"}>
            Separator
          </div>
        )}

        {/* Separator handle (always first) */}
        <div
          className="template-token-handle"
          style={{ top: `${HANDLE_START}rem` }}
        >
          <HelpLabel
            type="target"
            position={Position.Left}
            id="separator"
            style={{
              position: 'relative',
              left: '0',
              top: '0',
              transform: 'none',
              background: separatorSourceId ? '#555' : '#999',
            }}
            helpActive={data.helpActive}
            helpLabel={data.helpActive ? "Separator" : ""}
            helpDescription={data.helpActive ? (helpInfo?.inputs?.[0]?.description ?? "") : ""}
          />
        </div>

        <div className="node-info">
          Inputs: {connectedInputCount}
        </div>

        {/* Dynamic input handles */}
        {Array.from({ length: totalInputHandles }).map((_, i) => {
          const handleId = `input-${i}`;
          const isConnected = handleConnections.has(handleId);

          return (
            <HelpLabel
              key={handleId}
              type="target"
              position={Position.Left}
              id={handleId}
              style={{
                top: `${HANDLE_START + (i + 1.7) * (HANDLE_SPACING * .8)}rem`,
                background: isConnected ? '#555' : '#999',
              }}
              helpActive={data.helpActive}
              helpLabel={i === 0 ? "Inputs" : ""}
              helpDescription={i === 0 ? (helpInfo?.inputs?.[1]?.description ?? "") : ""}
            />
          );
        })}

        <HelpLabel
          type="source"
          position={Position.Right}
          helpActive={data.helpActive}
          helpLabel={helpInfo?.outputs?.[0]?.label}
          helpDescription={helpInfo?.outputs?.[0]?.description}
        />
      </NodeContainer>
    </div>
  );
}
