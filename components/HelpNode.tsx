import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { NodeData } from '../App';
import NodeContainer from './NodeContainer';
import { getNodeCategory } from '../nodeRegistry';

export const HELP_TEXT = `Welcome to Textubes!

In Textubes, you connect boxes to each other to make text into different text. You can pan the view around by clicking and dragging on the background. Use mousewheel or trackpad scrolling to zoom in and out.

(Textubes does not currently work very well on smartphones.)

There are three kinds of boxes (or "nodes"):

- Text Sources (Blue)
- Text Transformers (Yellow)
- Text Destinations (Green)

Text starts in Sources, goes through Transformers, and finishes in Destinations.

The dots on the left side of a box are its inputs, and the dot on the right side is its output. You can click and drag on an output to connect it to an input (or vice versa).

An output can connect to multiple inputs, but an input can only connect to one output.

You can delete a node by clicking on it and pressing your delete key, or by clicking the [x] button in the node's top left corner.

You can delete a connection by clicking on it and pressing your delete key, or by dragging a different output to its input.

Textubes automatically saves the canvas in local browser storage as you work.
`;

export const HELP_CONTENT: React.ReactNode[] = [
  <p>(A <a href="https://paulstarr.dev/">Paul Starr</a> joint)</p>,
  <p>In Textubes, you connect boxes to each other to make text into different text. You can <b>pan</b> the view around by clicking and dragging on the background. Use mousewheel or trackpad scrolling to <b>zoom</b> in and out.</p>,
  <p><em>(Textubes does not currently work very well on smartphones.)</em></p>,
  <p>There are three kinds of boxes (or "nodes"):</p>,
  <ul>
    <li><strong style={{ color: '#0173b2' }}>Text Sources</strong> (Blue)</li>
    <li><strong style={{ color: '#de8f05' }}>Text Transformers</strong> (Yellow)</li>
    <li><strong style={{ color: '#029e73' }}>Text Destinations</strong> (Green)</li>
  </ul>,
  <p>Text starts in Sources, goes through Transformers, and finishes in Destinations.</p>,
  <p>The dots on the left side of a box are its <b>inputs</b>, and the dot on the right side is its <b>output</b>. You can click and drag on an output to connect it to an input (or vice versa).</p>,
  <p>An output can connect to multiple inputs, but an input can only connect to one output.</p>,
  <p>You can <b>delete a node</b> by clicking on it and pressing your delete key, or by clicking the [x] button in the node's top left corner.</p>,
  <p>You can <b>delete a connection</b> by clicking on it and pressing your delete key, or by dragging a different output to its input.</p>,
  <p>Textubes automatically saves the canvas state in local browser storage as you work. Clicking <strong>Save</strong> will download the canvas as a file, and <strong>Load</strong> lets you load a file you've previously downloaded.</p>,
  <p>The <strong>Publish</strong> button saves the graph to a public URL. The published view of a Textubes graph displays only Text Source and Result nodes, and makes it quick to use a flow without loading a complicated interface.</p>
];

export default function HelpNode({ id, data, selected, type }: NodeProps<Node<NodeData>>) {
  return (
    <NodeContainer id={id} selected={selected} title="Help" isDarkMode={data.isDarkMode} category={getNodeCategory(type)}>
      <div className="node-description">
        Outputs helpful information about Textubes
      </div>
      <Handle type="source" position={Position.Right} />
    </NodeContainer>
  );
}
