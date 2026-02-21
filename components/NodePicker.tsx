import { NODE_REGISTRY } from "../nodeRegistry";
import { useRef, useState, useEffect } from "react";
import { getAvailablePresets, type PresetMetadata } from "../utils/presetUtils";

type NodePickerProps = {
  onAddNode: (nodeType: string) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onExport: () => void;
  onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onLoadPreset: (filename: string) => void;
  onPublish: () => void;
  publishedUrl: string;
  onClearPublishedUrl: () => void;
  title: string;
  onTitleChange: (title: string) => void;
  onHelp: () => void;
  onClear: () => void;
};

export default function NodePicker({ onAddNode, isDarkMode, onToggleDarkMode, onExport, onImport, onLoadPreset, onPublish, publishedUrl, onClearPublishedUrl, title, onTitleChange, onHelp, onClear }: NodePickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [presets, setPresets] = useState<PresetMetadata[]>([]);

  // Load preset list on mount
  useEffect(() => {
    setPresets(getAvailablePresets());
  }, []);

  // Group nodes by category, filtering out hidden nodes
  const visible = Object.entries(NODE_REGISTRY).filter(([_, config]) => !config.hidden);
  const inputs = visible.filter(([_, config]) => config.category === 'input');
  const sources = visible.filter(([_, config]) => config.category === 'source');
  const transformers = visible.filter(([_, config]) => config.category === 'transformer');
  const destinations = visible.filter(([_, config]) => config.category === 'destination');

  return (
    <div className={`node-picker ${isDarkMode ? 'dark-mode' : ''}`}>
      <div className="node-picker-group">
        <select
          className="node-picker-select"
          onChange={(e) => {
            const target = e.target as HTMLSelectElement;
            if (target.value) {
              onAddNode(target.value);
              target.value = "";
            }
          }}
          defaultValue=""
        >
          <option value="" disabled>
            Add node...
          </option>
          <optgroup label="Text Inputs">
            {inputs.map(([key, config]) => (
              <option key={key} value={key}>
                {config.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Text Generators">
            {sources.map(([key, config]) => (
              <option key={key} value={key}>
                {config.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Transformers">
            {transformers.map(([key, config]) => (
              <option key={key} value={key}>
                {config.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Destinations">
            {destinations.map(([key, config]) => (
              <option key={key} value={key}>
                {config.label}
              </option>
            ))}
          </optgroup>
        </select>
        <select
          className="node-picker-select"
          onChange={(e) => {
            const target = e.target as HTMLSelectElement;
            if (target.value) {
              if (confirm('Load this preset? This will replace your current canvas.')) {
                onLoadPreset(target.value);
              }
              target.value = "";
            }
          }}
          defaultValue=""
        >
          <option value="" disabled>
            Load preset...
          </option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.displayName}
            </option>
          ))}
        </select>
        <button
          className="node-picker-button"
          onClick={onExport}
          title="Export flow as JSON"
        >
          Save
        </button>
        <button
          className="node-picker-button"
          onClick={() => fileInputRef.current?.click()}
          title="Load flow or Tracery grammar"
        >
          Load
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.py,.txt"
          onChange={onImport}
          style={{ display: 'none' }}
        />
      </div>
      <div className="node-picker-divider" />
      <div className="node-picker-group">
        <input
          type="text"
          className="node-picker-title nodrag"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled flow"
        />
        <button
          className="node-picker-button"
          onClick={onPublish}
          title="Publish flow and copy share link"
        >
          Publish
        </button>
        {publishedUrl && (
          <span className="published-url-inline">
            <a href={publishedUrl} target="_blank" rel="noopener noreferrer">{publishedUrl.replace(/^https?:\/\//, '')}</a>
            <button
              className="published-url-copy"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(publishedUrl);
                } catch {}
              }}
              title="Copy link"
            >
              📋
            </button>
            <button
              className="published-url-dismiss"
              onClick={onClearPublishedUrl}
              title="Dismiss"
            >
              ×
            </button>
          </span>
        )}
      </div>
      <div className="node-picker-divider" />
      <div className="node-picker-group">
        <button
          className="node-picker-button"
          onClick={onToggleDarkMode}
          title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDarkMode ? "☀️" : "🌙"}
        </button>
        <button
          className="node-picker-button"
          onClick={onHelp}
          title="Help"
        >
          ❓
        </button>
        <button
          className="node-picker-button"
          onClick={onClear}
          title="Clear canvas"
        >
          🗑️
        </button>
      </div>
    </div>
  );
}
