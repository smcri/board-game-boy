import React, { useState } from 'react';
import { LlmProvider, SearchProvider, DEFAULT_MODELS, PROVIDER_LABELS } from '@bgb/shared';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Select } from './ui/Select';
import { useKeys } from '../lib/keys-hook';

/**
 * Normalise a pasted/typed API key:
 *  - trim whitespace
 *  - replace Unicode dashes (–, —, ‒, ―, ‐, ‑) with ASCII '-'
 *  - replace smart quotes (“ ” ‘ ’) with their ASCII equivalents
 *  - strip zero-width characters (U+200B/200C/200D/FEFF)
 * Why: macOS "Smart Dashes" silently converts '-' to an en-dash on paste,
 * which then fails the HTTP header validator in api.ts. Doing this at the
 * input boundary means stored keys are always valid.
 */
function normalizeKey(raw: string): string {
  return raw
    // Strip ASCII control chars anywhere in the string — CR, LF, tab, NUL,
    // form-feed, etc. PDF viewers and Notes-app frequently inject U+000D (CR)
    // mid-string on copy, which then fails the HTTP header validator.
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Strip zero-width / BOM characters (invisible to the eye).
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Replace Unicode dashes with ASCII '-'.
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    // Replace smart quotes with ASCII equivalents.
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // Non-breaking space → regular space (then trim).
    .replace(/\u00A0/g, ' ')
    .trim();
}

/**
 * Settings panel for LLM and search provider configuration.
 * Allows users to select providers, set API keys, and forget all keys.
 */
export function SettingsPanel() {
  const keys = useKeys();

  const [llmProvider, setLlmProvider] = useState<LlmProvider>('openai');
  const [llmKey, setLlmKey] = useState(keys.llmKey(llmProvider) || '');
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [searchProvider, setSearchProvider] = useState<SearchProvider>('tavily');
  const [searchKey, setSearchKey] = useState(keys.searchKey(searchProvider) || '');
  const [showSearchKey, setShowSearchKey] = useState(false);

  const handleLlmProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value as LlmProvider;
    setLlmProvider(newProvider);
    setLlmKey(keys.llmKey(newProvider) || '');
  };

  const handleSearchProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value as SearchProvider;
    setSearchProvider(newProvider);
    setSearchKey(keys.searchKey(newProvider) || '');
  };

  const handleSaveLlmKey = () => {
    if (llmKey.trim()) {
      keys.setLlmKey(llmProvider, llmKey);
    }
  };

  const handleSaveSearchKey = () => {
    if (searchKey.trim()) {
      keys.setSearchKey(searchProvider, searchKey);
    }
  };

  const handleForgetAllKeys = () => {
    if (confirm('Are you sure? This will clear all API keys from your browser.')) {
      keys.forget();
      setLlmKey('');
      setSearchKey('');
    }
  };

  const llmProviders = Object.keys(DEFAULT_MODELS) as LlmProvider[];
  const searchProviders: SearchProvider[] = ['tavily', 'brave', 'serpapi'];

  return (
    <Card className="mb-4">
      <CardHeader>
        <h2 className="text-lg font-semibold">Settings</h2>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* LLM Provider */}
        <div>
          <Label htmlFor="llm-provider">LLM Provider</Label>
          <Select
            id="llm-provider"
            value={llmProvider}
            onChange={handleLlmProviderChange}
            className="w-full"
          >
            {llmProviders.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500 mt-1">
            Model: {DEFAULT_MODELS[llmProvider]}
          </p>
        </div>

        {/* LLM API Key */}
        <div>
          <Label htmlFor="llm-key">LLM API Key</Label>
          <div className="flex gap-2">
            <Input
              id="llm-key"
              type={showLlmKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              inputMode="text"
              data-form-type="other"
              value={llmKey}
              onChange={(e) => setLlmKey(normalizeKey(e.target.value))}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text');
                if (text) {
                  e.preventDefault();
                  setLlmKey(normalizeKey(text));
                }
              }}
              placeholder="sk-..."
              className="flex-1 font-mono"
            />
            <Button onClick={() => setShowLlmKey((v) => !v)} variant="secondary" size="sm" type="button">
              {showLlmKey ? 'Hide' : 'Show'}
            </Button>
            <Button onClick={handleSaveLlmKey} variant="secondary" size="sm">
              Save
            </Button>
          </div>
          {keys.hasLlmKey(llmProvider) && (
            <p className="text-xs text-green-600 mt-1">✓ Key stored</p>
          )}
        </div>

        {/* Search Provider */}
        <div>
          <Label htmlFor="search-provider">Search Provider</Label>
          <Select
            id="search-provider"
            value={searchProvider}
            onChange={handleSearchProviderChange}
            className="w-full"
          >
            {searchProviders.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </Select>
        </div>

        {/* Search API Key */}
        <div>
          <Label htmlFor="search-key">Search API Key</Label>
          <div className="flex gap-2">
            <Input
              id="search-key"
              type={showSearchKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              inputMode="text"
              data-form-type="other"
              value={searchKey}
              onChange={(e) => setSearchKey(normalizeKey(e.target.value))}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text');
                if (text) {
                  e.preventDefault();
                  setSearchKey(normalizeKey(text));
                }
              }}
              placeholder="api-key..."
              className="flex-1 font-mono"
            />
            <Button onClick={() => setShowSearchKey((v) => !v)} variant="secondary" size="sm" type="button">
              {showSearchKey ? 'Hide' : 'Show'}
            </Button>
            <Button onClick={handleSaveSearchKey} variant="secondary" size="sm">
              Save
            </Button>
          </div>
          {keys.hasSearchKey(searchProvider) && (
            <p className="text-xs text-green-600 mt-1">✓ Key stored</p>
          )}
        </div>

        {/* Forget All Keys */}
        <Button onClick={handleForgetAllKeys} variant="danger" className="w-full">
          Forget all keys
        </Button>
      </CardContent>
    </Card>
  );
}
