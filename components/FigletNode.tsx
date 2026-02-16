import { Position, useNodesData, useReactFlow, type NodeProps, type Node, useNodeConnections } from '@xyflow/react';
import { useEffect } from 'react';
import type { NodeData } from '../App';
import NodeContainer from './NodeContainer';
import HelpLabel from './HelpLabel';
import { getNodeCategory, getNodeHelp } from '../nodeRegistry';
import { getSourceValue } from '../utils/nodeUtils';

import figlet from 'figlet';
import standard from 'figlet/fonts/Standard';
import big from 'figlet/fonts/Big';
import slant from 'figlet/fonts/Slant';
import small from 'figlet/fonts/Small';
import smallSlant from 'figlet/fonts/Small Slant';
import doom from 'figlet/fonts/Doom';
import banner from 'figlet/fonts/Banner';
import block from 'figlet/fonts/Block';
import lean from 'figlet/fonts/Lean';
import ansiShadow from 'figlet/fonts/ANSI Shadow';
import threeD from 'figlet/fonts/3-D';
import future from 'figlet/fonts/Future';
import script from 'figlet/fonts/Script';
import ivrit from 'figlet/fonts/Ivrit';
import thick from 'figlet/fonts/Thick';
import blurVisionASCII from 'figlet/fonts/BlurVision ASCII';
import tmplr from 'figlet/fonts/tmplr';
import dietCola from 'figlet/fonts/Diet Cola';


// Pre-parse all fonts so textSync works immediately
figlet.parseFont("Standard", standard);
figlet.parseFont("Big", big);
figlet.parseFont("Slant", slant);
figlet.parseFont("Small", small);
figlet.parseFont("Small Slant", smallSlant);
figlet.parseFont("Doom", doom);
figlet.parseFont("Banner", banner);
figlet.parseFont("Block", block);
figlet.parseFont("Lean", lean);
figlet.parseFont("ANSI Shadow", ansiShadow);
figlet.parseFont("3-D", threeD);
figlet.parseFont("Future", future);
figlet.parseFont("Script", script);
figlet.parseFont("Ivrit", ivrit);
figlet.parseFont("Thick", thick);
figlet.parseFont("BlurVision ASCII", blurVisionASCII);
figlet.parseFont("Tmplr", tmplr);
figlet.parseFont("Diet Cola", dietCola);


const FONTS = [
  "Standard",
  "Big",
  "Slant",
  "Small",
  "Small Slant",
  "Doom",
  "Banner",
  "Block",
  "Lean",
  "ANSI Shadow",
  "3-D",
  "Future",
  "Script",
  "Ivrit",
  "Thick",
  "BlurVision ASCII",
  "Tmplr",
  "Diet Cola",
] as const;

type FigletFont = typeof FONTS[number];

type FigletNodeData = NodeData & {
  font?: FigletFont;
};

function renderFiglet(text: string, font: FigletFont): string {
  if (!text) return '';
  try {
    return figlet.textSync(text, { font }) ?? '';
  } catch {
    return text;
  }
}

export default function FigletNode({ id, data, selected, type }: NodeProps<Node<FigletNodeData>>) {
  const { updateNodeData } = useReactFlow();
  const connections = useNodeConnections({ handleType: 'target' });
  const sourceIds = connections.map((connection) => connection.source);
  const nodesData = useNodesData(sourceIds);
  const helpInfo = getNodeHelp(type);
  const font: FigletFont = data.font ?? 'Standard';

  useEffect(() => {
    if (sourceIds.length === 0) {
      if (data.value !== '') {
        updateNodeData(id, { value: '' });
      }
      return;
    }

    const firstConnection = connections[0];
    const firstNode = nodesData[0];
    const inputValue = getSourceValue(firstNode, firstConnection);

    const outputValue = renderFiglet(inputValue, font);

    if (data.value !== outputValue) {
      updateNodeData(id, { value: outputValue });
    }
  }, [nodesData, sourceIds.length, id, updateNodeData, data.value, font]);

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
        title="FIGlet"
        isDarkMode={data.isDarkMode}
        category={getNodeCategory(type)}
        onHelpToggle={toggleHelp}
        helpActive={data.helpActive}
      >
        <HelpLabel
          type="target"
          position={Position.Left}
          helpActive={data.helpActive}
          helpLabel={helpInfo?.inputs?.[0]?.label}
          helpDescription={helpInfo?.inputs?.[0]?.description}
        />
        <div className="node-description">
          ASCII art text
        </div>
        <select
          className="nodrag node-select"
          value={font}
          onChange={(e) => updateNodeData(id, { font: e.target.value as FigletFont })}
        >
          {FONTS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
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
