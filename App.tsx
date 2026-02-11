import { useState, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Panel,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type ReactFlowInstance,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getNodeTypes, getInitialNodeData } from "./nodeRegistry";
import NodePicker from "./components/NodePicker";
import { loadPresetFile, validatePresetData } from "./utils/presetUtils";
import { HELP_CONTENT } from "./components/HelpNode";

export type NodeData = {
  value?: string;
  isDarkMode?: boolean;
  helpActive?: boolean;
  lockedInPublished?: boolean;
};

const nodeTypes = getNodeTypes();

/** Translate nodes so their bounding box is centered at the origin */
function centerNodes<T extends { position: { x: number; y: number } }>(nodes: T[]): T[] {
  if (nodes.length === 0) return nodes;
  const minX = Math.min(...nodes.map(n => n.position.x));
  const maxX = Math.max(...nodes.map(n => n.position.x));
  const minY = Math.min(...nodes.map(n => n.position.y));
  const maxY = Math.max(...nodes.map(n => n.position.y));
  const offsetX = -(minX + maxX) / 2;
  const offsetY = -(minY + maxY) / 2;
  return nodes.map(n => ({
    ...n,
    position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
  }));
}

const STORAGE_KEY_NODES = "textubes-nodes";
const STORAGE_KEY_EDGES = "textubes-edges";
const STORAGE_KEY_DARK_MODE = "textubes-dark-mode";
const STORAGE_KEY_TITLE = "textubes-title";

const defaultNodes: Node<NodeData>[] = [
  {
    id: "source1",
    type: "source",
    position: { x: 50, y: 100 },
    data: {
      value:
        "(Drag the resize control at the bottom right of this text area to make the box bigger!)\n\n",
    },
  },
  {
    id: "concatenate1",
    type: "concatenate",
    position: { x: 350, y: 150 },
    data: { value: "" },
  },
  {
    id: "help1",
    type: "help",
    position: { x:50, y: 350 },
    data: getInitialNodeData("help"),
  },
  {
    id: "result1",
    type: "result",
    position: { x: 600, y: 100 },
    data: { value: "" },
  },
];
const defaultEdges: Edge[] = [
  {
    id: "e-help1-concatenate1",
    source: "help1",
    target: "concatenate1",
        targetHandle: "input-1",
  },
  {
    id: "e-source1-concatenate1",
    source: "source1",
    target: "concatenate1",
  },
    {
    id: "e-concatenate1-result1",
    source: "concatenate1",
    target: "result1",
  },
];

// Load from localStorage or use defaults
const loadFromStorage = <T,>(key: string, defaultValue: T): T => {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return defaultValue;

    const parsed = JSON.parse(stored);

    // If we have an empty array (cleared canvas), use defaults
    if (Array.isArray(parsed) && parsed.length === 0) {
      return defaultValue;
    }

    return parsed;
  } catch (error) {
    console.error(`Error loading ${key} from localStorage:`, error);
    return defaultValue;
  }
};

export default function App({ initialFlowId }: { initialFlowId?: string } = {}) {
  const [nodes, setNodes] = useState<Node<NodeData>[]>(() =>
    loadFromStorage(STORAGE_KEY_NODES, defaultNodes)
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    loadFromStorage(STORAGE_KEY_EDGES, defaultEdges)
  );
  const [isDarkMode, setIsDarkMode] = useState(() =>
    loadFromStorage(STORAGE_KEY_DARK_MODE, false)
  );
  const [title, setTitle] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_TITLE) ?? "";
    } catch {
      return "";
    }
  });
  const [showHelp, setShowHelp] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState("");
  const [selectedNodes, setSelectedNodes] = useState<Node<NodeData>[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<Edge[]>([]);

  // Load flow from API when initialFlowId is provided (fork mode)
  useEffect(() => {
    if (!initialFlowId) return;

    fetch(`/api/flows/${initialFlowId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Flow not found");
        return res.json();
      })
      .then((flowData: any) => {
        if (!flowData.nodes || !flowData.edges) {
          alert("Invalid flow data");
          return;
        }
        const nodesWithDarkMode = flowData.nodes.map((node: any) => ({
          ...node,
          data: { ...node.data, isDarkMode: flowData.darkMode ?? isDarkMode },
        }));
        setNodes(nodesWithDarkMode);
        setEdges(flowData.edges);
        if (typeof flowData.darkMode === "boolean") {
          setIsDarkMode(flowData.darkMode);
        }
        if (typeof flowData.title === "string") {
          setTitle(flowData.title);
        }

        // Fit view to the loaded flow after React Flow processes the nodes
        requestAnimationFrame(() => {
          reactFlowInstanceRef.current?.fitView();
        });
      })
      .catch((err: Error) => {
        console.error("Failed to load flow:", err);
        alert("Could not load shared flow. It may not exist.");
      });
  }, [initialFlowId]);

  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);

  const addNode = useCallback((nodeType: string) => {
    // Calculate viewport center for new node placement
    let position = { x: 100, y: 100 }; // fallback default

    if (reactFlowInstanceRef.current) {
      const viewport = reactFlowInstanceRef.current.getViewport();
      const offsetJitter = Math.floor(Math.random() * 25) - 25;
      position = {
        x: ((-viewport.x + window.innerWidth / 2) / viewport.zoom) + offsetJitter,
        y: ((-viewport.y + window.innerHeight / 2) / viewport.zoom) + offsetJitter,
      };
    }

    const newNode: Node<NodeData> = {
      id: `${nodeType}-${Date.now()}`,
      type: nodeType,
      position,
      data: { ...getInitialNodeData(nodeType), isDarkMode },
    };
    setNodes((nodes) => [...nodes, newNode]);
  }, [isDarkMode]);

  const exportFlow = useCallback(() => {
    const flowData = {
      version: 1,
      title,
      nodes: centerNodes(nodes),
      edges,
      darkMode: isDarkMode,
    };

    const dataStr = JSON.stringify(flowData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `textubes-flow-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [nodes, edges, isDarkMode, title]);

  const importFlow = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const flowData = JSON.parse(content);

        // Basic validation
        if (!flowData.nodes || !Array.isArray(flowData.nodes)) {
          alert('Invalid flow file: missing nodes array');
          return;
        }
        if (!flowData.edges || !Array.isArray(flowData.edges)) {
          alert('Invalid flow file: missing edges array');
          return;
        }

        // Update dark mode state for all nodes
        const nodesWithDarkMode = flowData.nodes.map((node: Node<NodeData>) => ({
          ...node,
          data: { ...node.data, isDarkMode: flowData.darkMode ?? isDarkMode },
        }));

        setNodes(nodesWithDarkMode);
        setEdges(flowData.edges);
        if (typeof flowData.darkMode === 'boolean') {
          setIsDarkMode(flowData.darkMode);
        }
        setTitle(typeof flowData.title === 'string' ? flowData.title : '');

        // Fit view to the newly loaded nodes after React Flow processes them
        requestAnimationFrame(() => {
          reactFlowInstanceRef.current?.fitView();
        });
      } catch (error) {
        console.error('Error importing flow:', error);
        alert('Error loading flow file. Please check the file format.');
      }
    };
    reader.readAsText(file);

    // Reset the input so the same file can be loaded again
    event.target.value = '';
  }, [isDarkMode]);

  const loadPreset = useCallback((presetId: string) => {
    try {
      // Load preset data from compiled registry
      const presetData = loadPresetFile(presetId);

      // Validate structure
      if (!validatePresetData(presetData)) {
        alert('Invalid preset file format');
        return;
      }

      // Apply current dark mode state to all nodes
      const nodesWithDarkMode = presetData.nodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          isDarkMode: isDarkMode
        }
      }));

      // Load preset and fit view to show all nodes
      setNodes(nodesWithDarkMode);
      setEdges(presetData.edges);
      setTitle(typeof presetData.title === 'string' ? presetData.title : '');

      requestAnimationFrame(() => {
        reactFlowInstanceRef.current?.fitView();
      });

    } catch (error) {
      console.error('Error loading preset:', error);
      alert(`Failed to load preset: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [isDarkMode]);

  const publishFlow = useCallback(async () => {
    const flowData = {
      version: 1,
      title,
      nodes: centerNodes(nodes),
      edges,
      darkMode: isDarkMode,
    };

    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(flowData),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`Failed to publish: ${err.error || "Unknown error"}`);
        return;
      }

      const { id } = await res.json();
      const url = `${window.location.origin}/s/${id}`;
      setPublishedUrl(url);

      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // clipboard not available — URL is still shown inline
      }
    } catch (err) {
      console.error("Publish error:", err);
      alert("Failed to publish flow. Is the server running?");
    }
  }, [nodes, edges, isDarkMode, title]);

  const clearCanvas = useCallback(() => {
    if (confirm('Clear all nodes and connections? This cannot be undone.')) {
      setNodes([]);
      setEdges([]);
      setTitle('');
    }
  }, []);

  const onSelectionChange = useCallback<OnSelectionChangeFunc>(({ nodes, edges }) => {
    setSelectedNodes(nodes as Node<NodeData>[]);
    setSelectedEdges(edges);
  }, []);

  const duplicateSelection = useCallback(() => {
    if (selectedNodes.length === 0) return;

    const now = Date.now();
    // Map old node ID → new node ID
    const idMap = new Map<string, string>();

    const newNodes = selectedNodes.map((node, i) => {
      const newId = `${node.type}-${now}-${i}`;
      idMap.set(node.id, newId);
      return {
        ...node,
        id: newId,
        position: { x: node.position.x + 50, y: node.position.y + 50 },
        data: { ...structuredClone(node.data), isDarkMode },
        selected: false,
      };
    });

    // Only duplicate edges where both endpoints are in the selection
    const newEdges = selectedEdges
      .filter(e => idMap.has(e.source) && idMap.has(e.target))
      .map(e => ({
        ...e,
        id: `e-${idMap.get(e.source)}-${idMap.get(e.target)}-${e.sourceHandle ?? ''}-${e.targetHandle ?? ''}`,
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
        selected: false,
      }));

    setNodes(prev => prev.map(n => ({ ...n, selected: false })).concat(newNodes.map(n => ({ ...n, selected: true }))));
    setEdges(prev => prev.map(e => ({ ...e, selected: false })).concat(newEdges));
  }, [selectedNodes, selectedEdges, isDarkMode]);

  const arrangeSelectedNodes = useCallback((operation: string) => {
    const rfInstance = reactFlowInstanceRef.current;
    if (!rfInstance || selectedNodes.length < 2) return;

    // Collect measured dimensions
    const measured: { id: string; x: number; y: number; w: number; h: number }[] = [];
    for (const node of selectedNodes) {
      const internal = rfInstance.getInternalNode(node.id);
      const w = internal?.measured?.width;
      const h = internal?.measured?.height;
      if (w == null || h == null) continue;
      measured.push({ id: node.id, x: node.position.x, y: node.position.y, w, h });
    }
    if (measured.length < 2) return;

    const newPositions = new Map<string, { x: number; y: number }>();

    switch (operation) {
      case 'align-left': {
        const minX = Math.min(...measured.map(n => n.x));
        for (const n of measured) newPositions.set(n.id, { x: minX, y: n.y });
        break;
      }
      case 'align-center': {
        const avgCX = measured.reduce((sum, n) => sum + n.x + n.w / 2, 0) / measured.length;
        for (const n of measured) newPositions.set(n.id, { x: avgCX - n.w / 2, y: n.y });
        break;
      }
      case 'align-right': {
        const maxRight = Math.max(...measured.map(n => n.x + n.w));
        for (const n of measured) newPositions.set(n.id, { x: maxRight - n.w, y: n.y });
        break;
      }
      case 'align-top': {
        const minY = Math.min(...measured.map(n => n.y));
        for (const n of measured) newPositions.set(n.id, { x: n.x, y: minY });
        break;
      }
      case 'align-middle': {
        const avgMY = measured.reduce((sum, n) => sum + n.y + n.h / 2, 0) / measured.length;
        for (const n of measured) newPositions.set(n.id, { x: n.x, y: avgMY - n.h / 2 });
        break;
      }
      case 'align-bottom': {
        const maxBottom = Math.max(...measured.map(n => n.y + n.h));
        for (const n of measured) newPositions.set(n.id, { x: n.x, y: maxBottom - n.h });
        break;
      }
      case 'distribute-h': {
        if (measured.length < 3) return;
        const sorted = [...measured].sort((a, b) => a.x - b.x);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const totalSpan = last.x - first.x;
        const step = totalSpan / (sorted.length - 1);
        for (let i = 0; i < sorted.length; i++) {
          newPositions.set(sorted[i].id, { x: first.x + step * i, y: sorted[i].y });
        }
        break;
      }
      case 'distribute-v': {
        if (measured.length < 3) return;
        const sorted = [...measured].sort((a, b) => a.y - b.y);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const totalSpan = last.y - first.y;
        const step = totalSpan / (sorted.length - 1);
        for (let i = 0; i < sorted.length; i++) {
          newPositions.set(sorted[i].id, { x: sorted[i].x, y: first.y + step * i });
        }
        break;
      }
    }

    if (newPositions.size === 0) return;
    setNodes(prev => prev.map(node => {
      const pos = newPositions.get(node.id);
      return pos ? { ...node, position: pos } : node;
    }));
  }, [selectedNodes]);

  // Keyboard shortcut: Cmd+D / Ctrl+D to duplicate selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        if (selectedNodes.length > 0) {
          e.preventDefault();
          duplicateSelection();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNodes, duplicateSelection]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<NodeData>>[]) =>
      setNodes((nodesSnapshot) => applyNodeChanges(changes, nodesSnapshot)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) =>
      setEdges((edgesSnapshot) => applyEdgeChanges(changes, edgesSnapshot)),
    []
  );
  const onConnect = useCallback((params: Connection) => {
    setEdges((edgesSnapshot) => {
      // Remove any existing edges connected to the same target handle
      // Note: handles without explicit IDs will have null/undefined as their handle ID
      const filteredEdges = edgesSnapshot.filter((edge) => {
        const sameTarget = edge.target === params.target;
        // Compare handles, treating null/undefined as equivalent
        const edgeHandle = edge.targetHandle ?? null;
        const paramsHandle = params.targetHandle ?? null;
        const sameTargetHandle = edgeHandle === paramsHandle;

        // Keep edges that don't match both target AND handle
        return !(sameTarget && sameTargetHandle);
      });

      // Add the new edge
      return addEdge(params, filteredEdges);
    });
  }, []);

  // Save to localStorage whenever nodes, edges, or dark mode changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_NODES, JSON.stringify(nodes));
    } catch (error) {
      console.error("Error saving nodes to localStorage:", error);
    }
  }, [nodes]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_EDGES, JSON.stringify(edges));
    } catch (error) {
      console.error("Error saving edges to localStorage:", error);
    }
  }, [edges]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_DARK_MODE, JSON.stringify(isDarkMode));
    } catch (error) {
      console.error("Error saving dark mode to localStorage:", error);
    }
  }, [isDarkMode]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_TITLE, title);
    } catch (error) {
      console.error("Error saving title to localStorage:", error);
    }
  }, [title]);

  // Update all nodes' dark mode state whenever it changes
  useEffect(() => {
    setNodes((prevNodes) =>
      prevNodes.map((node) => ({
        ...node,
        data: { ...node.data, isDarkMode },
      }))
    );
  }, [isDarkMode]);

  return (
    <div className={`app-container ${isDarkMode ? 'dark-mode' : ''}`}>
      <NodePicker
        onAddNode={addNode}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        onExport={exportFlow}
        onImport={importFlow}
        onLoadPreset={loadPreset}
        onPublish={publishFlow}
        publishedUrl={publishedUrl}
        onClearPublishedUrl={() => setPublishedUrl("")}
        title={title}
        onTitleChange={setTitle}
        onHelp={() => setShowHelp(true)}
        onClear={clearCanvas}
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(instance) => reactFlowInstanceRef.current = instance}
        onConnectStart={(_, params) => {
          // When starting a connection, remove any existing edges on the target handle
          if (params.handleType === "source") {
            // User is dragging from a source handle - we'll handle this in onConnect
            return;
          }
        }}
        fitView
        colorMode={isDarkMode ? "dark" : "light"}
        onSelectionChange={onSelectionChange}
      >
        <MiniMap nodeStrokeWidth={3} />
        <Controls />
        {selectedNodes.length > 0 && (
          <Panel position="bottom-center">
            <div className={`selection-panel ${isDarkMode ? 'dark-mode' : ''}`}>
              <span className="selection-panel-text">
                {selectedNodes.length} node{selectedNodes.length !== 1 ? 's' : ''} selected
              </span>
              <button className="selection-panel-button" onClick={duplicateSelection}>
                Duplicate
              </button>
              {selectedNodes.length >= 2 && (
                <select
                  className="selection-panel-select nodrag"
                  value=""
                  onChange={(e) => {
                    arrangeSelectedNodes(e.target.value);
                    e.target.value = "";
                  }}
                >
                  <option value="" disabled>Arrange...</option>
                  <optgroup label="Align">
                    <option value="align-left">Left</option>
                    <option value="align-center">Center</option>
                    <option value="align-right">Right</option>
                    <option value="align-top">Top</option>
                    <option value="align-middle">Middle</option>
                    <option value="align-bottom">Bottom</option>
                  </optgroup>
                  <optgroup label="Distribute">
                    <option value="distribute-h" disabled={selectedNodes.length < 3}>
                      Horizontally{selectedNodes.length < 3 ? ' (3+ nodes)' : ''}
                    </option>
                    <option value="distribute-v" disabled={selectedNodes.length < 3}>
                      Vertically{selectedNodes.length < 3 ? ' (3+ nodes)' : ''}
                    </option>
                  </optgroup>
                </select>
              )}
            </div>
          </Panel>
        )}
      </ReactFlow>
      {showHelp && (
        <div className="help-modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <button className="help-modal-close" onClick={() => setShowHelp(false)}>×</button>
            <h2>Welcome to Textubes!</h2>
            <div className="help-modal-content">
              {HELP_CONTENT.map((el, i) => (
                <div key={i}>{el}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
