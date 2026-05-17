import React, { useState } from 'react';
import { LlmProvider, SearchProvider, DEFAULT_MODELS } from '@bgb/shared';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Select } from './ui/Select';
import { useKeys } from '../lib/keys-hook';

/**
 * Settings panel for LLM and search provider configuration.
 * Allows users to select providers, set API keys, and forget all keys.
 */
export function SettingsPanel() {
  const keys = useKeys();

  const [llmProvider, setLlmProvider] = useState<LlmProvider>('openai');
  const [llmKey, setLlmKey] = useState(keys.llmKey(llmProvider) || '');
  const [searchProvider, setSearchProvider] = useState<SearchProvider>('tavily');
  const [searchKey, setSearchKey] = useState(keys.searchKey(searchProvider) || '');

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
                {p.charAt(0).toUpperCase() + p.slice(1)}
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
              type="password"
              value={llmKey}
              onChange={(e) => setLlmKey(e.target.value)}
              placeholder="sk-..."
              className="flex-1"
            />
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
              type="password"
              value={searchKey}
              onChange={(e) => setSearchKey(e.target.value)}
              placeholder="api-key..."
              className="flex-1"
            />
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
