import { KeyRound, Sparkles } from "lucide-react";
import { useState } from "react";
import type { GeminiModelId } from "../core/gemini/modelCatalog";
import { defaultGeminiModel, GEMINI_MODELS } from "../core/gemini/modelCatalog";

type GeminiKeyPanelProps = {
  disabled: boolean;
  onDetect: (apiKey: string, model: GeminiModelId) => Promise<void>;
};

export function GeminiKeyPanel({ disabled, onDetect }: GeminiKeyPanelProps) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<GeminiModelId>(defaultGeminiModel().id);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setError("");
    if (!apiKey.trim()) {
      setError("Enter a dedicated Gemini API key for assisted anchor detection.");
      return;
    }
    setRunning(true);
    try {
      await onDetect(apiKey.trim(), model);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gemini detection failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <details className="gemini-panel collapsible-card" open>
      <summary className="panel-heading compact">
        <div>
          <h3>Gemini-assisted anchors</h3>
          <p>Optional shortcut. Gemini proposes four anchors only; analysis still uses original local pixels.</p>
        </div>
        <Sparkles size={18} />
      </summary>
      <div className="collapsible-card-body">
        <label>
          <span>Dedicated Gemini API key</span>
          <div className="key-input">
            <KeyRound size={15} />
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Stored in this page state only"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </label>
        <label>
          <span>Model</span>
          <select value={model} onChange={(event) => setModel(event.target.value as GeminiModelId)}>
            {GEMINI_MODELS.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <p className="disclosure">
          In Gemini-assisted mode, the selected image is sent from your browser to Gemini using your own API key.
          Use a dedicated key and avoid broad unrestricted Google Cloud keys.
        </p>
        <button className="primary-button full-width" type="button" disabled={disabled || running} onClick={() => void run()}>
          <Sparkles size={16} /> {running ? "Detecting..." : "Detect anchors"}
        </button>
        {error && <div className="error-banner compact-error">{error}</div>}
      </div>
    </details>
  );
}
