import React, { useState } from 'react';
import { BuildMode, DEFAULT_MODELS, LlmProvider } from '@bgb/shared';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Select } from './ui/Select';
import { Textarea } from './ui/Textarea';
import * as api from '../lib/api';

/**
 * Props for BuildForm component.
 */
export interface BuildFormProps {
  onBuildStart: (bundleId: string) => void;
  onStreamEvent: (event: any) => void;
}

/**
 * Build form for creating a new board game.
 * Collects mode, prompt, custom_rules, LLM provider/model, and search provider.
 * On submit, calls api.createBuild and then opens the SSE stream.
 */
export function BuildForm({ onBuildStart, onStreamEvent }: BuildFormProps) {
  const [mode, setMode] = useState<BuildMode>('fully_custom');
  const [prompt, setPrompt] = useState('');
  const [customRules, setCustomRules] = useState('');
  const [llmProvider, setLlmProvider] = useState<LlmProvider>('openai');
  const [llmModel, setLlmModel] = useState(DEFAULT_MODELS['openai']);
  const [searchProvider, setSearchProvider] = useState('tavily');
  const [loading, setLoading] = useState(false);

  const llmProviders = Object.keys(DEFAULT_MODELS) as LlmProvider[];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      alert('Please enter a prompt');
      return;
    }

    setLoading(true);
    try {
      const response = await api.createBuild({
        mode,
        prompt,
        custom_rules: customRules || undefined,
        llm_provider: llmProvider,
        llm_model: llmModel,
        search_provider: searchProvider,
      });

      onBuildStart(response.bundle_id);

      // Open SSE stream and emit events to parent.
      const closeStream = api.openBuildStream(response.bundle_id, (event) => {
        onStreamEvent(event);
      });

      // Keep stream open; parent is responsible for closing it.
    } catch (err) {
      console.error('Build error:', err);
      alert(`Build failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">Create a new game</h2>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Mode */}
          <div>
            <Label>Build Mode</Label>
            <div className="space-y-2 mt-2">
              {(['known_game', 'known_with_overrides', 'fully_custom'] as const).map((m) => (
                <label key={m} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    value={m}
                    checked={mode === m}
                    onChange={(e) => setMode(e.target.value as BuildMode)}
                  />
                  <span className="text-sm">
                    {m === 'known_game' && 'Known game (e.g., Chess)'}
                    {m === 'known_with_overrides' && 'Known game with custom rules'}
                    {m === 'fully_custom' && 'Fully custom game'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Prompt */}
          <div>
            <Label htmlFor="prompt">Game description</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Terraforming Mars, or paste custom rules..."
              rows={4}
              className="w-full"
            />
          </div>

          {/* Custom Rules (shown for known_with_overrides and fully_custom) */}
          {(mode === 'known_with_overrides' || mode === 'fully_custom') && (
            <div>
              <Label htmlFor="custom-rules">Custom Rules (optional)</Label>
              <Textarea
                id="custom-rules"
                value={customRules}
                onChange={(e) => setCustomRules(e.target.value)}
                placeholder="Additional rules or modifications..."
                rows={3}
                className="w-full"
              />
            </div>
          )}

          {/* LLM Provider */}
          <div>
            <Label htmlFor="llm-provider">LLM Provider</Label>
            <Select
              id="llm-provider"
              value={llmProvider}
              onChange={(e) => {
                const provider = e.target.value as LlmProvider;
                setLlmProvider(provider);
                setLlmModel(DEFAULT_MODELS[provider]);
              }}
              className="w-full"
            >
              {llmProviders.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </Select>
          </div>

          {/* LLM Model */}
          <div>
            <Label htmlFor="llm-model">Model</Label>
            <Input
              id="llm-model"
              type="text"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              className="w-full"
            />
          </div>

          {/* Search Provider */}
          <div>
            <Label htmlFor="search-provider">Search Provider</Label>
            <Select
              id="search-provider"
              value={searchProvider}
              onChange={(e) => setSearchProvider(e.target.value)}
              className="w-full"
            >
              <option value="tavily">Tavily</option>
              <option value="brave">Brave</option>
              <option value="serpapi">SerpAPI</option>
            </Select>
          </div>

          {/* Submit Button */}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Building...' : 'Build game'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
