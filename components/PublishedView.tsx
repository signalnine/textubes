import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getNodeTypes } from "../nodeRegistry";
import type { NodeData } from "../App";

const nodeTypes = getNodeTypes();

export default function PublishedView() {
  const [nodes, setNodes] = useState<Node<NodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Extract flow ID from URL
  const flowId = useMemo(() => {
    const match = window.location.pathname.match(/^\/s\/([a-zA-Z0-9]+)$/);
    return match?.[1] ?? null;
  }, []);

  // Fetch flow data
  useEffect(() => {
    if (!flowId) {
      setError("Invalid URL");
      setLoading(false);
      return;
    }

    fetch(`/api/flows/${flowId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Flow not found");
        return res.json();
      })
      .then((flowData: any) => {
        if (!flowData.nodes || !flowData.edges) {
          throw new Error("Invalid flow data");
        }
        const dark = flowData.darkMode ?? false;
        setIsDarkMode(dark);
        const nodesWithDarkMode = flowData.nodes.map((node: any) => ({
          ...node,
          data: { ...node.data, isDarkMode: dark },
        }));
        setNodes(nodesWithDarkMode);
        setEdges(flowData.edges);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [flowId]);

  // Find source and result nodes
  const sourceNodes = useMemo(
    () => nodes.filter((n) => n.type === "source"),
    [nodes]
  );
  const resultNodes = useMemo(
    () => nodes.filter((n) => n.type === "result"),
    [nodes]
  );

  // Handle input changes — update the source node's data
  const handleInputChange = useCallback(
    (nodeId: string, value: string) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, value } } : n
        )
      );
    },
    []
  );

  // React Flow needs these to process internal node data updates
  const onNodesChange = useCallback(
    (changes: NodeChange<Node<NodeData>>[]) =>
      setNodes((prev) => applyNodeChanges(changes, prev)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) =>
      setEdges((prev) => applyEdgeChanges(changes, prev)),
    []
  );

  // Copy result to clipboard
  const copyResult = useCallback((value: string) => {
    navigator.clipboard.writeText(value);
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <h2>Error</h2>
        <p>{error}</p>
        <a href="/">Go to editor</a>
      </div>
    );
  }

  const bgColor = isDarkMode ? "#1a1a1a" : "#ffffff";
  const textColor = isDarkMode ? "#e0e0e0" : "#000000";
  const borderColor = isDarkMode ? "#555" : "#ccc";
  const inputBg = isDarkMode ? "#3a3a3a" : "#ffffff";
  const resultBg = isDarkMode ? "#333" : "#f9f9f9";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: bgColor,
        color: textColor,
        fontFamily:
          "Bahnschrift, 'DIN Alternate', 'Franklin Gothic Medium', 'Nimbus Sans Narrow', sans-serif-condensed, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "1rem 2rem",
          borderBottom: `1px solid ${borderColor}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <a
          href="/"
          style={{
            fontSize: "1.25rem",
            fontWeight: "bold",
            textDecoration: "none",
            color: textColor,
          }}
        >
          Textubes
        </a>
        <a
          href={`/edit/${flowId}`}
          style={{
            padding: "0.5rem 1rem",
            border: `1px solid ${borderColor}`,
            borderRadius: "0.5rem",
            textDecoration: "none",
            color: textColor,
            background: inputBg,
            fontSize: "0.875rem",
          }}
        >
          Fork
        </a>
      </div>

      {/* Published form */}
      <div
        style={{
          maxWidth: "640px",
          margin: "0 auto",
          padding: "2rem",
        }}
      >
        {/* Inputs */}
        {sourceNodes.map((node) => (
          <div key={node.id} style={{ marginBottom: "1.5rem" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.875rem",
                marginBottom: "0.5rem",
                color: isDarkMode ? "#aaa" : "#666",
              }}
            >
              Input
            </label>
            <textarea
              value={node.data.value || ""}
              onChange={(e) => handleInputChange(node.id, e.target.value)}
              placeholder={node.data.value || "Enter text..."}
              maxLength={10000}
              style={{
                width: "100%",
                minHeight: "100px",
                padding: "0.5rem",
                fontSize: "0.875rem",
                fontFamily:
                  "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
                border: `1px solid ${borderColor}`,
                borderRadius: "0.5rem",
                background: inputBg,
                color: textColor,
                resize: "vertical",
              }}
            />
          </div>
        ))}

        {/* Divider */}
        {sourceNodes.length > 0 && resultNodes.length > 0 && (
          <hr
            style={{
              border: "none",
              borderTop: `1px solid ${borderColor}`,
              margin: "2rem 0",
            }}
          />
        )}

        {/* Outputs */}
        {resultNodes.map((node) => {
          const value = node.data.value || "";
          return (
            <div key={node.id} style={{ marginBottom: "1.5rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "0.5rem",
                }}
              >
                <label
                  style={{
                    fontSize: "0.875rem",
                    color: isDarkMode ? "#aaa" : "#666",
                  }}
                >
                  Result
                </label>
                <button
                  onClick={() => copyResult(value)}
                  disabled={!value}
                  style={{
                    padding: "0.25rem 0.75rem",
                    fontSize: "0.75rem",
                    border: `1px solid ${borderColor}`,
                    borderRadius: "0.5rem",
                    background: inputBg,
                    color: textColor,
                    cursor: value ? "pointer" : "not-allowed",
                    opacity: value ? 1 : 0.5,
                  }}
                >
                  Copy
                </button>
              </div>
              <textarea
                readOnly
                value={value || "No output"}
                style={{
                  width: "100%",
                  minHeight: "100px",
                  padding: "0.5rem",
                  fontSize: "0.875rem",
                  fontFamily:
                    "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
                  border: `1px solid ${borderColor}`,
                  borderRadius: "0.5rem",
                  background: resultBg,
                  color: value ? textColor : isDarkMode ? "#777" : "#999",
                  whiteSpace: "pre-wrap",
                  resize: "vertical",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Hidden React Flow — drives all transformations */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "1px",
          height: "1px",
          overflow: "hidden",
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          colorMode={isDarkMode ? "dark" : "light"}
        />
      </div>
    </div>
  );
}
