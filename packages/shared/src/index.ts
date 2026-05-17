// Barrel exports — single source of truth for backend, scaffold, and UI.

export * from './providers.js';
export * from './ecs.js';
export * from './dsl.js';
export * from './rules.js';
export * from './assets.js';
export * from './bundle.js';
export * from './state.js';
export * from './sse.js';

/** API surface constants. */
export const API_HEADER_LLM_KEY = 'x-llm-api-key';
export const API_HEADER_SEARCH_KEY = 'x-search-api-key';
