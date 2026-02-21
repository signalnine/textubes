import { Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import type { NodeData } from '../App';
import NodeContainer from './NodeContainer';
import HelpLabel from './HelpLabel';
import { getNodeCategory, getNodeHelp } from '../nodeRegistry';
import { processEscapes } from '../utils/processEscapes';

type SourceNodeData = NodeData & {
  rawText?: string;
  parseEscapes?: boolean;
};

export default function SourceNode({ data, id, selected, type }: NodeProps<Node<SourceNodeData>>) {
  const { updateNodeData } = useReactFlow();
  const helpInfo = getNodeHelp(type);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    updateNodeData(id, {
      rawText: raw,
      value: data.parseEscapes ? processEscapes(raw) : raw,
    });
  };

  const handleToggleEscapes = (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    const raw = data.rawText ?? data.value ?? '';
    updateNodeData(id, {
      parseEscapes: enabled,
      value: enabled ? processEscapes(raw) : raw,
    });
  };

  const toggleHelp = () => {
    updateNodeData(id, { helpActive: !data.helpActive });
  };

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
        title="Text Block"
        style={{ minWidth: '200px' }}
        isDarkMode={data.isDarkMode}
        category={getNodeCategory(type)}
        onHelpToggle={toggleHelp}
        helpActive={data.helpActive}
      >
        <div className="node-description">
          Enter text manually
        </div>
        <textarea
          className="nodrag node-textarea"
          value={data.rawText ?? data.value ?? ''}
          onChange={handleChange}
          placeholder="Enter text here..."
          maxLength={10000}
        />
        <label className="nodrag node-label" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', marginTop: '4px', opacity: 0.7, cursor: 'pointer' }}>
          <input
            className="nodrag"
            type="checkbox"
            checked={!!data.parseEscapes}
            onChange={handleToggleEscapes}
          />
          Parse escape sequences (\n, \t, \_, \\)
        </label>
        <label className="nodrag node-label" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', marginTop: '4px', opacity: 0.7, cursor: 'pointer' }}>
          <input
            className="nodrag"
            type="checkbox"
            checked={!!data.lockedInPublished}
            onChange={(e) => updateNodeData(id, { lockedInPublished: e.target.checked })}
          />
          Hide in published view
        </label>
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
