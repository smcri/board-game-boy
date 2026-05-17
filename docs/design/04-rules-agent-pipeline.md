# Design Document: Rules Agent Pipeline (Agentic Board Game Builder MVP)

## 1. Purpose & Scope

The **Rules Agent Pipeline** is responsible for converting free-form game rule sources into a structured `RulesDSL` representation suitable for simulation and validation. This document describes the complete end-to-end pipeline:

1. **Mode selection**: User chooses between three build modes (known game, known game + custom overrides, fully custom).
2. **Information gathering**: Fetch and extract rules from multiple sources (PDFs, web pages) with source priority enforcement.
3. **Semantic extraction**: LLM-driven parsing into RulesDSL using a closed effect vocabulary and ECS component registry.
4. **Conflict detection**: Identify and categorise discrepancies between sources.
5. **Output**: Structured RulesDSL block with accompanying conflicts array.

The agent is invoked as one leg of the larger LangGraph orchestrator (see doc 05) and produces deterministic, cacheable outputs suitable for downstream simulation (doc 06).

---

## 2. Locked Decisions

### 2.1 Build Modes (User-Selectable in UI)

Users choose **exactly one** of three modes:

| Mode | Input | Example | Scope |
|------|-------|---------|-------|
| **known_game** | Game name only | "Terraforming Mars" | Search + fetch authoritative rules; trust source priority |
| **known_game + custom** | Game name + rule overrides | "Catan with fog of war" | Fetch baseline, then merge user's pasted/uploaded overrides |
| **fully_custom** | Complete rules text or file | "Custom dungeon-crawler" | No fetching; parse user's supplied text directly |

**Rationale**: Avoids auto-detection confusion; sets explicit user expectations.

### 2.2 Web Fetching: Real, Not Stubbed

The pipeline executes **real HTTP requests** with:
- **Search provider** (user picks at runtime via Settings): Tavily / Brave / SerpAPI
- **Direct HTTP fetch**: via undici with per-host throttling, configurable timeouts (default 10s), polite `User-Agent` header, and best-effort robots.txt respect
- **Content extraction**:
  - **HTML**: `@mozilla/readability` + `jsdom` for clean text/markdown
  - **PDF**: `pdf-parse` for rulebook PDFs
- **Caching**: SQLite table `fetches(url_hash PK, url, content_hash, content, source_type, fetched_at)` colocated with LangGraph checkpointer in `${DATA_DIR}/bgb.sqlite`

**Why this stack**:
- Works with all LLM providers (including Ollama) without vendor lock-in
- User-selectable search provider avoids forced paid dependencies
- PDFs are **first-class** because board game rulebooks are almost always PDFs
- HTTP caching makes rebuilds fast and avoids hammering servers

### 2.3 Source Priority (STRICT, Non-Negotiable)

Sources are bucketed and consumed in this order:

```
1. PDF (authoritative rulebooks)
2. Publisher (official website)
3. BGG (Board Game Geek wiki/reference)
4. Fan (community sites, fan wikis, YouTube scripts)
```

**Priority rule**: Highest bucket's claim **wins**; lower buckets only contribute to conflicts.

**Example**: If a PDF says "Castling requires neither king nor rook has moved" and BGG says "Castling requires unmoved pieces _and_ no checks on intervening squares", the PDF claim is authoritative, and the BGG claim is recorded as a `rule_detail` conflict.

### 2.4 LLM Parsing with Structured Output

- Use LangChain `initChatModel()` + `.withStructuredOutput(RulesDslSchema)` (Zod) for provider-agnostic LLM integration
- System prompt includes:
  - Closed Effect DSL vocabulary (from doc 03: `move`, `spawn`, `remove`, `toggle`, `check_condition`, `branch`)
  - ECS component registry (from doc 02: valid entity types, components, attributes)
  - Instruction: "Only emit components and verbs from the provided vocabulary; unsupported effects must be tagged as conflicts"
- **Retry logic**: One automatic retry if Zod validation fails; append validator error message to retry prompt
- **Reconciliation pass**: After extracting authoritative DSL, run a second LLM call (with `ConflictsSchema` output) to identify discrepancies from lower-priority sources

### 2.5 Conflict Representation

Conflicts capture rule ambiguity and unsupported expressions:

```typescript
type Conflict = {
  rule: string;                          // e.g., "en_passant_capture"
  sources: SourceRef[];                  // [{ url, bucket: "bgg", title }]
  description: string;                   // Human-readable mismatch
  resolution?: string;                   // What we chose
  severity: 'core_mechanic'             // Blocks gameplay (e.g., win condition)
           | 'rule_detail'               // Affects specific action (e.g., castling rules)
           | 'flavor'                    // Cosmetic/narrative (e.g., piece names)
           | 'unsupported_effect';       // Cannot express in closed DSL
  confidence: number;                    // 0.0 to 1.0; LLM's certainty
};

type SourceRef = {
  url: string;
  bucket: 'pdf' | 'publisher' | 'bgg' | 'fan';
  title: string;
  snippet?: string;
};
```

---

## 3. Trade-offs Considered (Deeply)

### 3.1 Web Fetching Strategy

**Alternatives**: LLM-only | LLM + provider tools | dedicated API | direct fetch + readability | fallback chain

**Winner**: Dedicated search API (Tavily/Brave/SerpAPI) + direct fetch + Readability + PDF-parse

**Rationale**:
- LLM-only (Claude, GPT) knowledge cutoff is stale; board game rules are actively updated
- Provider-native tools (OpenAI's `web_search`, Anthropic's search) lock us into one vendor and require their API
- Dedicated search API + direct fetch avoids vendor lock-in, supports free-tier providers (Tavily 1k/mo, Brave 2k/mo), and degrades gracefully when APIs are unavailable
- PDF support is essential; no search API abstracts away PDFs well

### 3.2 Search Provider Selection

**Alternatives**: Tavily only | Brave only | SerpAPI only | user pick at runtime

**Winner**: User picks at runtime (via Settings UI)

**Rationale**:
- Tavily: free tier (1k/month), LLM-friendly, no vendor lock-in
- Brave: independent index, free tier (2k/month), privacy-focused
- SerpAPI: paid, highest quality, best for commercial use cases
- Locking contributors to one service (e.g., Tavily) blocks those without an API key; user choice allows flexibility

### 3.3 Source Priority Strategy

**Alternatives**: Confidence-weighted reconciliation | search-rank-first | strict priority

**Winner**: Strict priority (as per original design doc 01)

**Rationale**:
- Predictable and reproducible
- Produces clean "authoritative claim + dissenters" output
- Avoids expensive reconciliation models
- Aligns with board game community norms (PDFs are _the_ reference)

### 3.4 HTML Extraction Method

**Alternatives**: Cheerio (lightweight) | raw HTML to LLM | Playwright (headless browser)

**Winner**: Readability + jsdom

**Rationale**:
- Readability excels at extracting article-like content (rulebook webpages often are)
- jsdom is lightweight and widely available
- Cheerio is regex-fragile; Playwright requires a browser binary (not suitable for HF Spaces)

### 3.5 Caching Strategy

**Alternatives**: Always fetch | cache in-memory | SQLite cache

**Winner**: SQLite cache (same db as LangGraph checkpointer)

**Rationale**:
- Cuts repeated-build cost and avoids hammering remote servers
- Makes session replay deterministic (critical for debugging + HITL)
- Colocating in the LangGraph checkpoint DB simplifies deployment

### 3.6 Robots.txt Compliance

**Alternatives**: Strict parsing | best-effort | ignore

**Winner**: Best-effort

**Rationale**:
- We identify ourselves with a polite `User-Agent` and respect common crawl directives
- Full robots.txt parsing (URL regex, crawl-delay, request-rate) is out of scope for MVP
- Throttle per-host (default 1 request per 2 seconds per host) demonstrates respect

### 3.7 Reconciliation: Single Call vs. Two Calls

**Alternatives**: Combined call (plan + fetch + extract + reconcile in one prompt) | two calls

**Winner**: Two calls (extract authoritative first, then reconcile lower buckets)

**Rationale**:
- Cleaner separation of concerns
- Lower token cost (second call is cheaper because context is narrower)
- Better event logging (can trace each step independently)
- Easier to retry one leg without re-fetching

### 3.8 Conflict Severity Model

**Alternatives**: Binary (blocks/does-not-block) | three-tier

**Winner**: Three-tier (core_mechanic | rule_detail | flavor | unsupported_effect)

**Rationale**:
- Allows nuanced reporting without blocking core gameplay
- Aligns with typical board game rule categories
- Unsupported effects get their own bucket (signals "we tried but DSL can't express it")

### 3.9 LLM Provider Posture

**Alternatives**: Hard-code OpenAI | use LangChain `initChatModel()`

**Winner**: Provider-agnostic via `initChatModel()`

**Rationale**:
- Enables contributors with Ollama or other local models to participate
- No vendor lock-in; future-proof for new providers
- Aligns with MVP goal of accessibility

---

## 4. Interfaces / Data Contracts

### 4.1 Pipeline Input

```typescript
type RulesAgentInput = {
  mode: 'known_game' | 'known_game_custom' | 'fully_custom';
  gameTitle: string;
  customRules?: string;        // (only if mode !== 'known_game')
  customRulesFile?: File;      // or uploaded file
  searchProvider: 'tavily' | 'brave' | 'serpapi';
  apiKey: string;              // for selected provider
};
```

### 4.2 Pipeline Output

```typescript
type RulesAgentOutput = {
  rulesDsl: RulesDSL;           // From doc 03: entities, components, actions, win conditions
  conflicts: Conflict[];        // Array of discrepancies and unsupported effects
  fetchStats: {
    queriesPlanned: number;
    urlsFetched: number;
    cacheHits: number;
    totalBytes: number;
  };
  sources: SourceRef[];         // All URLs used, including lower-bucket dissenters
  timestamp: string;            // ISO 8601
};
```

### 4.3 Normalized Search Result

```typescript
type SearchResult = {
  url: string;
  title: string;
  snippet: string;
  source_type?: 'pdf' | 'html' | 'unknown';  // Inferred from URL + content
};
```

### 4.4 Bucketing & Source Classification Rules

```typescript
function classifySourceBucket(url: string, contentType: string): SourceBucket {
  if (url.endsWith('.pdf') || contentType.includes('pdf')) return 'pdf';
  if (matchPublisherDomain(url)) return 'publisher';   // e.g., hasbro.com, zmangames.com
  if (url.includes('boardgamegeek.com')) return 'bgg';
  return 'fan';
}
```

### 4.5 SSE Event Stream (Emitted During Pipeline)

Each event is a JSON object with `type` and optional metadata:

| Event Type | Payload | Purpose |
|------------|---------|---------|
| `search_started` | `{ queries: string[] }` | Signals beginning of search phase |
| `search_hit` | `{ url, title, bucket }` | Each search result received |
| `fetch_started` | `{ url, bucket }` | Beginning to fetch a URL |
| `fetch_done` | `{ url, bucket, bytes, durationMs }` | URL fetch completed |
| `cache_hit` | `{ url, cached_at }` | Result came from cache |
| `llm_started` | `{ phase: 'extract' \| 'reconcile', inputTokens }` | LLM call beginning |
| `llm_done` | `{ phase, outputTokens, durationMs, conflicts_found }` | LLM call completed |
| `conflicts_detected` | `{ count, severities: {...} }` | Summary of all conflicts |

### 4.6 Cache Schema (SQLite)

```sql
CREATE TABLE fetches (
  url_hash TEXT PRIMARY KEY,              -- SHA256(url)
  url TEXT NOT NULL UNIQUE,
  content_hash TEXT,                      -- SHA256(content); used for dedup
  content TEXT,                           -- Full extracted text/markdown
  source_type TEXT,                       -- 'pdf' | 'html' | 'unknown'
  fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP                    -- Optional TTL (e.g., 30 days)
);
```

---

## 5. Worked Example: Chess End-to-End

**Scenario**: User selects `known_game` mode, enters "Chess", picks Tavily search with a free API key.

### Step 1: Plan Queries
Queries planned:
- "Chess rulebook PDF"
- "Chess official rules FIDE"
- "Chess board game geek wiki"

### Step 2: Search
Tavily returns ~15 hits:
- `pdf`: fide.com/archive/Laws_of_Chess.pdf (2023)
- `publisher`: uschess.org/rules, fide.org/rules
- `bgg`: boardgamegeek.com/wiki/page/Chess
- `fan`: chess.com, lichess.org, chess24.com

SSE emits: `search_hit` for each result, bucketed.

### Step 3: Fetch & Extract (PDF Bucket First)
1. Fetch `fide.com/.../Laws_of_Chess.pdf` (cache miss → HTTP GET)
2. pdf-parse extracts ~50KB of rules text
3. Cache stored; SSE emits `fetch_done`

### Step 4: Extract Authoritative RulesDSL (First LLM Call)
**System prompt includes**:
- Closed DSL verbs: `move`, `check_condition`, `toggle`, `branch`
- ECS registry: `BoardNode` (64 squares), `Piece` (6 types), `Player` (2), `Phase`, `Turn`, `Threat` (singletons)
- Instruction: "Map the Chess rules to these components and actions only; emit unsupported effects as conflicts."

**LLM output (simplified)**:
```json
{
  "entities": [
    { "id": "board", "type": "Board", "components": [{"type": "Grid", "width": 8, "height": 8}] },
    { "id": "white_player", "type": "Player", "components": [{"type": "Owner", "player_index": 0}] },
    { "id": "black_player", "type": "Player", "components": [{"type": "Owner", "player_index": 1}] },
    { "id": "white_king", "type": "Piece", "components": [{"type": "PieceType", "name": "King"}, {"type": "Location", "square": "e1"}] },
    // ... 31 more pieces
  ],
  "actions": [
    {
      "name": "move_piece",
      "params": [{"name": "piece_id"}, {"name": "target_square"}],
      "effects": [
        {"verb": "move", "args": ["piece_id", "target_square"]},
        {"verb": "check_condition", "args": ["is_legal_move(piece_id, target_square)"], "onFail": "reject"}
      ]
    },
    // ... capture, castling, en passant, promotion
  ],
  "winConditions": [
    {"type": "checkmate", "description": "Opponent king is in check and has no legal moves"}
  ]
}
```

SSE emits: `llm_started`, `llm_done` with token counts.

### Step 5: Reconciliation Pass (Second LLM Call, Lower Buckets)
**Input**: Authoritative DSL (above) + extracts from publisher + BGG + fan sites.

**LLM emits conflicts**:
```json
{
  "conflicts": [
    {
      "rule": "castling_through_check",
      "sources": [
        {"url": "boardgamegeek.com/wiki/...", "bucket": "bgg", "title": "Chess Wiki"}
      ],
      "description": "BGG says 'King may not castle through check'; FIDE rules say 'through _or_ into check'.",
      "resolution": "FIDE (PDF) authority: cannot castle through check.",
      "severity": "rule_detail",
      "confidence": 0.92
    },
    {
      "rule": "en_passant_capture",
      "sources": [
        {"url": "chess.com/...", "bucket": "fan"},
        {"url": "lichess.org/...", "bucket": "fan"}
      ],
      "description": "Fan sites emphasize timing; FIDE is unambiguous. No functional conflict.",
      "severity": "flavor",
      "confidence": 0.88
    },
    {
      "rule": "castling_mechanics",
      "sources": [],
      "description": "Castling move (simultaneous king + rook movement) cannot be cleanly expressed as two separate DSL effects.",
      "severity": "unsupported_effect",
      "confidence": 0.95
    }
  ]
}
```

SSE emits: `conflicts_detected { count: 3, severities: { rule_detail: 1, flavor: 1, unsupported_effect: 1 } }`

### Step 6: Return to Graph
Pipeline returns:
- `rulesDsl`: Complete 64-square board, 32 pieces, move rules (with unsupported castling flagged)
- `conflicts`: 3 items (none block gameplay; castling is noted but basic moves work)
- `fetchStats`: 1 query planned, 1 PDF fetched, 0 cache hits, ~50KB
- `sources`: All URLs visited
- `timestamp`: ISO 8601

Graph proceeds to doc 05 (HITL or simulation).

---

## 6. Open Questions & Follow-ups

### 6.1 Multiple PDFs in a Single Bucket
**Q**: What if search returns 2+ PDFs (e.g., "Rules v1.0" and "Rules v2.3")?
**A (MVP)**: Fetch the first (highest-ranked by search engine); list others in conflicts as supporting sources. Future: detect versioning and prefer latest.

### 6.2 Very Long Rulebooks & Context Windows
**Q**: If a rulebook is 500KB (beyond LLM context), how do we extract rules?
**A (MVP)**: Truncate to first 50K tokens with instruction "Focus on core game mechanics, turn structure, and win conditions." Future: RAG or multi-pass summarization.

### 6.3 Non-English Rulebooks
**Q**: What if a game's primary PDF is in German or Japanese?
**A (MVP)**: Fetch succeeds but LLM may degrade; surface as a fetch warning. Future: auto-detect language + translate.

### 6.4 Game Name Disambiguation
**Q**: "Chess" could mean classic Chess, Chess960 (Fischer Random), 3D Chess, etc. How do we pick?
**A (MVP)**: Rely on search ranking; if ambiguous, let user clarify via custom mode or game-name field. Future: heuristic to prefer official/largest community (BGG popularity).

### 6.5 Multiple Authorities (e.g., FIDE vs USCF)
**Q**: Both are publisher-bucket sources; which wins?
**A (MVP)**: First by search rank; user can choose custom mode to override. Future: detect variant + let user pick authority in UI.

### 6.6 Structured Data (JSON/CSV) vs. Free-Text Rules
**Q**: Some games (e.g., Dominion) have their rules in a structured format. Should we parse differently?
**A (MVP)**: Treat as HTML content; Readability will extract the tabular data. Future: detect format + route to specialized parser.

---

## 7. References

- **Doc 02** (ECS Components & Entity Registry): Defines valid component types and entity structures that the RulesDSL must use.
- **Doc 03** (Effect DSL & Vocabulary): Defines the closed set of effects (`move`, `spawn`, `remove`, `toggle`, `check_condition`, `branch`) that the LLM may emit; effects outside this set are tagged `unsupported_effect`.
- **Doc 05** (LangGraph Orchestrator & HITL): Describes how the Rules Agent Pipeline is invoked within the larger workflow, and where conflicts flow to human review.
- **Doc 06** (Simulation & Validation Consumer): Describes how the output RulesDSL is consumed by the game engine.
- **Board Game Geek**: https://boardgamegeek.com (primary fan-bucket source)
- **Tavily Search API**: https://tavily.com (free tier 1k/month)
- **Brave Search**: https://api.search.brave.com (free tier 2k/month)
- **SerpAPI**: https://serpapi.com (paid)
- **Mozilla Readability**: https://github.com/mozilla/readability (HTML to readable text)
- **pdf-parse**: https://github.com/modesty/pdf-parse (PDF extraction)
- **undici**: https://github.com/nodejs/undici (HTTP client with connection pooling)
- **LangChain**: https://js.langchain.com/ (model integration + structured output)
- **Zod**: https://zod.dev (TypeScript schema validation)

---

**Document Version**: 1.0  
**Last Updated**: 2026-05-17  
**Status**: Locked (Ready for Implementation)
